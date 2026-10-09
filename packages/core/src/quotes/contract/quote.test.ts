import { readFileSync } from "node:fs";
import { join } from "node:path";

import { z } from "zod";

import {
  checkBatch,
  inQuoteWindow,
  parseResponse,
  type QuoteBatch,
  QuoteFeedError,
  type RawFxRate,
  type RawPrice,
  SYMBOL_PATTERN,
} from "./quote";

// 2026-10-09 18:30 in Buenos Aires.
const NOW = new Date("2026-10-09T21:30:00.000Z");
const TODAY = "2026-10-09";

const fx = (overrides: Partial<RawFxRate> = {}): RawFxRate => ({
  kind: "mep",
  rate_date: TODAY,
  buy: "1400.5",
  sell: "1450",
  source: "dolarapi",
  quoted_at: "2026-10-09T20:00:00.000Z",
  ...overrides,
});

const price = (overrides: Partial<RawPrice> = {}): RawPrice => ({
  symbol: "BTC",
  price_date: TODAY,
  price: "112345.1",
  currency: "USD",
  source: "kraken",
  quoted_at: NOW.toISOString(),
  ...overrides,
});

const counts = (batch: QuoteBatch) => ({
  fxRates: batch.fxRates.length,
  prices: batch.prices.length,
  staleCount: batch.staleCount,
  invalidCount: batch.invalidCount,
});

describe("inQuoteWindow", () => {
  it.each([
    ["a dollar rate at 17:59", "mep", TODAY, "2026-10-09T20:59:59.999Z", false],
    ["a dollar rate at 18:00", "mep", TODAY, "2026-10-09T21:00:00.000Z", true],
    ["a price at 09:00", "price", TODAY, "2026-10-09T12:00:00.000Z", false],
    ["UVA at 09:00", "uva", TODAY, "2026-10-09T12:00:00.000Z", true],
    ["yesterday", "mep", "2026-10-08", NOW.toISOString(), false],
    ["tomorrow", "uva", "2026-10-10", NOW.toISOString(), false],
  ] as const)("%s → %s", (_label, kind, date, now, kept) => {
    expect(inQuoteWindow(kind, date, new Date(now))).toBe(kept);
  });

  it("closes the window at midnight in Buenos Aires", () => {
    const lastMs = new Date("2026-10-10T02:59:59.999Z");
    const midnight = new Date("2026-10-10T03:00:00.000Z");
    expect(inQuoteWindow("mep", TODAY, lastMs)).toBe(true);
    expect(inQuoteWindow("mep", TODAY, midnight)).toBe(false);
    expect(inQuoteWindow("mep", "2026-10-10", midnight)).toBe(false);
    expect(inQuoteWindow("uva", "2026-10-10", midnight)).toBe(true);
  });
});

describe("checkBatch", () => {
  it("stamps each kept row with the read instant", () => {
    const batch = checkBatch({ fxRates: [fx()], prices: [price()] }, NOW);
    expect(batch.fxRates[0]).toEqual({
      ...fx(),
      fetched_at: NOW.toISOString(),
    });
    expect(batch.prices[0]?.fetched_at).toBe(NOW.toISOString());
    expect(counts(batch)).toEqual({
      fxRates: 1,
      prices: 1,
      staleCount: 0,
      invalidCount: 0,
    });
  });

  it.each([
    ["a zero rate", fx({ sell: "0" })],
    ["a negative buy", fx({ buy: "-1" })],
    ["buy above sell", fx({ buy: "1450.00000001", sell: "1450" })],
    ["13 integer digits", fx({ sell: "1000000000000" })],
    ["an exponent", fx({ sell: "1e21" })],
    ["9 decimals", fx({ sell: "1.123456789" })],
    ["a UVA buying rate", fx({ kind: "uva", buy: "1" })],
    ["a date that is not a day", fx({ rate_date: "2026-10-9" })],
    ["an instant without offset", fx({ quoted_at: "2026-10-09 20:00" })],
    // Postgres has no year 0.
    ["a quoted_at in the year 0", fx({ quoted_at: "0000-06-01T00:00:00Z" })],
    [
      "a quoted_at past the year 9999",
      fx({ quoted_at: "9999-12-31T23:59:59-23:59" }),
    ],
  ])("counts %s as invalid", (_label, row) => {
    expect(counts(checkBatch({ fxRates: [row], prices: [] }, NOW))).toEqual({
      fxRates: 0,
      prices: 0,
      staleCount: 0,
      invalidCount: 1,
    });
  });

  it.each([
    ["equal with padding", "1000.00000000", "1000", true],
    ["0.09 below 0.1", "0.09", "0.1", true],
    ["0.1 above 0.09", "0.1", "0.09", false],
    ["9.99999999 below 10", "9.99999999", "10", true],
    ["one unit in the last decimal", "1.00000001", "1", false],
  ])("compares buy and sell as decimals, %s", (_label, buy, sell, kept) => {
    const batch = checkBatch({ fxRates: [fx({ buy, sell })], prices: [] }, NOW);
    expect(batch.fxRates).toHaveLength(kept ? 1 : 0);
    expect(batch.invalidCount).toBe(kept ? 0 : 1);
  });

  it.each([
    ["lowercase", "btc"],
    ["a dash", "BTC-USD"],
    ["16 characters", "ABCDEFGHIJKLMNOP"],
    ["empty", ""],
  ])("counts a %s symbol as invalid", (_label, symbol) => {
    const batch = checkBatch({ fxRates: [], prices: [price({ symbol })] }, NOW);
    expect(batch.invalidCount).toBe(1);
  });

  it.each(["", "1e-7", "1e+21", "Infinity", "0.30000000000000004"])(
    "counts a price of %j as invalid",
    (value) => {
      const batch = checkBatch(
        { fxRates: [], prices: [price({ price: value })] },
        NOW,
      );
      expect(batch.invalidCount).toBe(1);
    },
  );

  // Postgres refuses a time zone offset beyond ±15:59, which would fail the
  // whole insert.
  it.each(["+16:00", "+23:59", "-23:59"])(
    "never keeps a quoted_at offset of %s",
    (offset) => {
      const batch = checkBatch(
        {
          fxRates: [fx({ quoted_at: `2026-10-09T20:00:00${offset}` })],
          prices: [],
        },
        NOW,
      );
      expect(batch.fxRates).toHaveLength(1);
      for (const row of batch.fxRates) {
        expect(row.quoted_at).toMatch(/Z$/);
      }
    },
  );

  it("counts yesterday's and tomorrow's rows as stale", () => {
    const batch = checkBatch(
      {
        fxRates: [fx({ rate_date: "2026-10-08" })],
        prices: [price({ price_date: "2026-10-10" })],
      },
      NOW,
    );
    expect(counts(batch)).toEqual({
      fxRates: 0,
      prices: 0,
      staleCount: 2,
      invalidCount: 0,
    });
  });

  it("counts a row both invalid and stale only as invalid", () => {
    const batch = checkBatch(
      {
        fxRates: [fx({ rate_date: "2026-10-08", sell: "0" })],
        prices: [price({ price_date: "2026-10-08", price: "" })],
      },
      NOW,
    );
    expect([batch.staleCount, batch.invalidCount]).toEqual([0, 2]);
  });

  it("keeps the last row per primary key and counts the others as invalid", () => {
    const batch = checkBatch(
      {
        fxRates: [
          fx({ sell: "1450" }),
          fx({ kind: "ccl" }),
          fx({ sell: "1460" }),
        ],
        prices: [price({ price: "1" }), price({ price: "2" })],
      },
      NOW,
    );
    expect(batch.fxRates.map((row) => [row.kind, row.sell])).toEqual([
      ["mep", "1460"],
      ["ccl", "1450"],
    ]);
    expect(batch.prices.map((row) => row.price)).toEqual(["2"]);
    expect([batch.staleCount, batch.invalidCount]).toEqual([0, 2]);
  });

  it("keeps a fresh row when a later duplicate is invalid", () => {
    const batch = checkBatch(
      { fxRates: [fx({ sell: "1450" }), fx({ sell: "0" })], prices: [] },
      NOW,
    );
    expect(batch.fxRates.map((row) => row.sell)).toEqual(["1450"]);
    expect(batch.invalidCount).toBe(1);
  });

  it("dedupes only the rows left after the stale ones", () => {
    const batch = checkBatch(
      {
        fxRates: [
          fx({ sell: "1450" }),
          fx({ rate_date: "2026-10-08", sell: "1500" }),
          fx({ sell: "1460" }),
        ],
        prices: [],
      },
      NOW,
    );
    expect(batch.fxRates.map((row) => row.sell)).toEqual(["1460"]);
    expect([batch.staleCount, batch.invalidCount]).toEqual([1, 1]);
  });
});

describe("parseResponse", () => {
  const okSchema = z.object({ ok: z.boolean() });

  it("throws a bad_shape that is not retried and carries only its code", () => {
    expect(() => parseResponse(okSchema, { detail: "provider text" })).toThrow(
      expect.objectContaining({
        name: "QuoteFeedError",
        message: "bad_shape",
        code: "bad_shape",
        retryable: false,
      }),
    );
  });

  it("returns the parsed value", () => {
    expect(parseResponse(okSchema, { ok: true })).toEqual({ ok: true });
  });
});

describe("QuoteFeedError", () => {
  it("carries only its code as the message", () => {
    const error = new QuoteFeedError("http_429", true);
    expect([error.message, error.code, error.retryable, error.name]).toEqual([
      "http_429",
      "http_429",
      true,
      "QuoteFeedError",
    ]);
  });
});

describe("SYMBOL_PATTERN", () => {
  it("is the pattern the prices.symbol CHECK uses", () => {
    const migration = readFileSync(
      join(
        __dirname,
        "../../../../../supabase/migrations/20261009094238_quotes.sql",
      ),
      "utf8",
    );
    expect(migration).toContain(`CHECK (symbol ~ '${SYMBOL_PATTERN.source}')`);
  });
});
