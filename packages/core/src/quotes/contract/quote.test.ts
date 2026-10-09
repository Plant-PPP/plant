import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { BUENOS_AIRES_TZ, Constants } from "@plant/shared";
import { z } from "zod";

import {
  checkBatch,
  feedErrorForStatus,
  isDailyIndex,
  parseResponse,
  QUOTE_FEED_CODES,
  QUOTE_FEED_ERROR_NAME,
  QUOTE_KEYS,
  QUOTE_STORE_CODES,
  QUOTE_STORE_ERROR_NAME,
  type QuoteBatch,
  QuoteError,
  QuoteFeedError,
  quoteFailureOf,
  QuoteStoreError,
  quoteWindow,
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
  quoted_at: "2026-10-09T20:00:00.000Z",
  ...overrides,
});

const price = (overrides: Partial<RawPrice> = {}): RawPrice => ({
  symbol: "BTC",
  price_date: TODAY,
  price: "112345.1",
  currency: "USD",
  quoted_at: NOW.toISOString(),
  ...overrides,
});

const counts = (batch: QuoteBatch) => ({
  fxRates: batch.fxRates.length,
  prices: batch.prices.length,
  stale: batch.refused.stale.length,
  invalid: batch.refused.invalid.length,
});

// Instants in Buenos Aires (UTC-3). 2026-10-09 is a Friday.
const at = (local: string) => new Date(`${local}-03:00`);
const FRIDAY = "2026-10-09";
const THURSDAY = "2026-10-08";
const SATURDAY = "2026-10-10";

describe("the test zone", () => {
  // Set in jest.config.cjs; a date string read in the host's zone lands on
  // the day before only west of UTC.
  it("is Buenos Aires", () => {
    expect(new Date("2026-10-10T00:00:00").getTimezoneOffset()).toBe(180);
  });
});

describe("quoteWindow", () => {
  it.each([
    [
      "a dollar rate at 17:59",
      "mep",
      FRIDAY,
      "2026-10-09T17:59:59.999",
      "early",
    ],
    ["a dollar rate at 18:00", "mep", FRIDAY, "2026-10-09T18:00:00", "kept"],
    ["a price at 09:00", "price", FRIDAY, "2026-10-09T09:00:00", "early"],
    ["a dollar rate at 15:00", "mep", FRIDAY, "2026-10-09T15:00:00", "early"],
    ["a price at 15:00", "price", FRIDAY, "2026-10-09T15:00:00", "early"],
    ["UVA at 09:00", "uva", FRIDAY, "2026-10-09T09:00:00", "kept"],
    ["UVA at 15:00", "uva", FRIDAY, "2026-10-09T15:00:00", "kept"],
    [
      "yesterday's dollar rate",
      "mep",
      THURSDAY,
      "2026-10-09T18:30:00",
      "stale",
    ],
    ["tomorrow's UVA", "uva", SATURDAY, "2026-10-09T18:30:00", "stale"],
    [
      "Friday's MEP on Saturday",
      "mep",
      FRIDAY,
      "2026-10-10T18:05:00",
      "closed",
    ],
    ["Friday's MEP on Sunday", "mep", FRIDAY, "2026-10-11T18:05:00", "closed"],
    [
      "Friday's MEP on Sunday at 21:05",
      "mep",
      FRIDAY,
      "2026-10-11T21:05:00",
      "closed",
    ],
    [
      "Friday's MEP on Saturday at 23:59",
      "mep",
      FRIDAY,
      "2026-10-10T23:59:00",
      "closed",
    ],
    [
      "Thursday's MEP on Friday at 21:05",
      "mep",
      THURSDAY,
      "2026-10-09T21:05:00",
      "stale",
    ],
    [
      "Wednesday's MEP on Saturday",
      "mep",
      "2026-10-07",
      "2026-10-10T18:05:00",
      "stale",
    ],
    [
      "Monday's MEP on Tuesday",
      "mep",
      "2026-10-05",
      "2026-10-06T18:05:00",
      "stale",
    ],
    [
      "Monday's MEP on Tuesday at 09:00",
      "mep",
      "2026-10-05",
      "2026-10-06T09:00:00",
      "early",
    ],
    [
      "Friday's price on Saturday",
      "price",
      FRIDAY,
      "2026-10-10T18:05:00",
      "stale",
    ],
    [
      "Saturday's UVA on Sunday at 09:00",
      "uva",
      SATURDAY,
      "2026-10-11T09:00:00",
      "stale",
    ],
    ["Friday's UVA on Saturday", "uva", FRIDAY, "2026-10-10T18:05:00", "stale"],
  ] as const)("%s → %s", (_label, kind, date, local, window) => {
    expect(quoteWindow(kind, date, at(local))).toBe(window);
  });

  it("starts a new day at midnight in Buenos Aires", () => {
    const lastMs = at("2026-10-09T23:59:59.999");
    const midnight = at("2026-10-10T00:00:00");
    expect(quoteWindow("mep", FRIDAY, lastMs)).toBe("kept");
    expect(quoteWindow("mep", FRIDAY, midnight)).toBe("early");
    expect(quoteWindow("mep", SATURDAY, midnight)).toBe("early");
    expect(quoteWindow("uva", SATURDAY, midnight)).toBe("kept");
  });
});

describe("checkBatch", () => {
  it("stamps each kept row with its source and the read instant", () => {
    const batch = checkBatch(
      { fxRates: [fx()], prices: [price()] },
      NOW,
      "dolarapi",
    );
    expect(batch.fxRates[0]).toEqual({
      ...fx(),
      source: "dolarapi",
      fetched_at: NOW.toISOString(),
    });
    expect(batch.prices[0]?.fetched_at).toBe(NOW.toISOString());
    expect(counts(batch)).toEqual({
      fxRates: 1,
      prices: 1,
      stale: 0,
      invalid: 0,
    });
  });

  it("stamps the read instant over a fetched_at the row carries", () => {
    const row = { ...fx(), fetched_at: "2020-01-01T00:00:00.000Z" };
    const batch = checkBatch({ fxRates: [row], prices: [] }, NOW, "dolarapi");
    expect(batch.fxRates.map((kept) => kept.fetched_at)).toEqual([
      NOW.toISOString(),
    ]);
  });

  it.each([
    ["a zero rate", fx({ sell: "0" })],
    ["a negative buy", fx({ buy: "-1" })],
    ["no buy", { ...fx(), buy: undefined } as unknown as RawFxRate],
    ["a UVA buying rate", fx({ kind: "uva", buy: "1" })],
    ["a date that is not a day", fx({ rate_date: "2026-10-9" })],
    ["an unknown kind", fx({ kind: "tarjeta" as RawFxRate["kind"] })],
    ["an instant without offset", fx({ quoted_at: "2026-10-09 20:00" })],
    ["a local instant", fx({ quoted_at: "2026-10-09T20:00:00" })],
    // Postgres has no year 0.
    ["a quoted_at in the year 0", fx({ quoted_at: "0000-06-01T00:00:00Z" })],
    [
      "a quoted_at past the year 9999",
      fx({ quoted_at: "9999-12-31T23:59:59-23:59" }),
    ],
  ])("counts %s as invalid", (_label, row) => {
    expect(
      counts(checkBatch({ fxRates: [row], prices: [] }, NOW, "dolarapi")),
    ).toEqual({
      fxRates: 0,
      prices: 0,
      stale: 0,
      invalid: 1,
    });
  });

  it.each([
    ["equal with padding", "1000.00000000", "1000", true],
    ["0.09 below 0.1", "0.09", "0.1", true],
    ["0.1 above 0.09", "0.1", "0.09", false],
    ["9.99999999 below 10", "9.99999999", "10", true],
    ["one unit in the last decimal", "1.00000001", "1", false],
  ])("compares buy and sell as decimals, %s", (_label, buy, sell, kept) => {
    const batch = checkBatch(
      { fxRates: [fx({ buy, sell })], prices: [] },
      NOW,
      "dolarapi",
    );
    expect(batch.fxRates).toHaveLength(kept ? 1 : 0);
    expect(batch.refused.invalid).toHaveLength(kept ? 0 : 1);
  });

  it.each([
    ["a lowercase symbol", price({ symbol: "btc" })],
    ["a symbol with a dash", price({ symbol: "BTC-USD" })],
    ["a 16-character symbol", price({ symbol: "ABCDEFGHIJKLMNOP" })],
    ["an empty symbol", price({ symbol: "" })],
    ["an unknown currency", price({ currency: "EUR" as RawPrice["currency"] })],
    ["a date that is not a day", price({ price_date: "2026-10-9" })],
    ["an empty price", price({ price: "" })],
    ["a float artifact", price({ price: "0.30000000000000004" })],
  ])("counts a price with %s as invalid", (_label, row) => {
    expect(
      counts(checkBatch({ fxRates: [], prices: [row] }, NOW, "dolarapi")),
    ).toEqual({
      fxRates: 0,
      prices: 0,
      stale: 0,
      invalid: 1,
    });
  });

  // Postgres refuses a time zone offset beyond ±15:59, which would fail the
  // whole insert.
  it.each([
    ["+16:00", "2026-10-09T04:00:00.000Z"],
    ["+23:59", "2026-10-08T20:01:00.000Z"],
    ["-23:59", "2026-10-10T19:59:00.000Z"],
  ])("stores a quoted_at with offset %s in UTC as %s", (offset, utc) => {
    const batch = checkBatch(
      {
        fxRates: [fx({ quoted_at: `2026-10-09T20:00:00${offset}` })],
        prices: [],
      },
      NOW,
      "dolarapi",
    );
    expect(batch.fxRates.map((row) => row.quoted_at)).toEqual([utc]);
  });

  it("counts yesterday's and tomorrow's rows as stale", () => {
    const batch = checkBatch(
      {
        fxRates: [fx({ rate_date: "2026-10-08" })],
        prices: [price({ price_date: "2026-10-10" })],
      },
      NOW,
      "dolarapi",
    );
    expect(counts(batch)).toEqual({
      fxRates: 0,
      prices: 0,
      stale: 2,
      invalid: 0,
    });
  });

  it("counts a row both invalid and stale only as invalid", () => {
    const batch = checkBatch(
      {
        fxRates: [fx({ rate_date: "2026-10-08", sell: "0" })],
        prices: [price({ price_date: "2026-10-08", price: "" })],
      },
      NOW,
      "dolarapi",
    );
    expect(batch.refused).toMatchObject({ stale: [], invalid: ["mep", "BTC"] });
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
      "dolarapi",
    );
    expect(batch.fxRates.map((row) => [row.kind, row.sell])).toEqual([
      ["mep", "1460"],
      ["ccl", "1450"],
    ]);
    expect(batch.prices.map((row) => row.price)).toEqual(["2"]);
    expect(batch.refused).toMatchObject({ stale: [], invalid: ["mep", "BTC"] });
  });

  it("keeps a price for each symbol", () => {
    const batch = checkBatch(
      {
        fxRates: [],
        prices: [price({ symbol: "BTC" }), price({ symbol: "ETH" })],
      },
      NOW,
      "dolarapi",
    );
    expect(batch.prices.map((row) => row.symbol)).toEqual(["BTC", "ETH"]);
    expect(batch.refused.invalid).toEqual([]);
  });

  it("before 18:00 keeps only UVA and counts the rest as early", () => {
    const morning = new Date("2026-10-09T13:00:00.000Z");
    const batch = checkBatch(
      { fxRates: [fx({ kind: "uva", buy: null }), fx()], prices: [price()] },
      morning,
      "dolarapi",
    );
    expect(batch.fxRates.map((row) => row.kind)).toEqual(["uva"]);
    expect(batch.prices).toEqual([]);
    expect(batch.refused).toEqual({
      early: ["mep", "BTC"],
      closed: [],
      stale: [],
      invalid: [],
    });
  });

  it("keeps a fresh row when a later duplicate is invalid", () => {
    const batch = checkBatch(
      { fxRates: [fx({ sell: "1450" }), fx({ sell: "0" })], prices: [] },
      NOW,
      "dolarapi",
    );
    expect(batch.fxRates.map((row) => row.sell)).toEqual(["1450"]);
    expect(batch.refused.invalid).toEqual(["mep"]);
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
      "dolarapi",
    );
    expect(batch.fxRates.map((row) => row.sell)).toEqual(["1460"]);
    expect(batch.refused).toMatchObject({ stale: ["mep"], invalid: ["mep"] });
  });

  it.each([
    ["an empty price", { fxRates: [], prices: [price({ price: "" })] }, "BTC"],
    [
      "an unknown kind",
      { fxRates: [fx({ kind: "tarjeta" as RawFxRate["kind"] })], prices: [] },
      "_unknown",
    ],
    [
      "a lowercase symbol",
      { fxRates: [], prices: [price({ symbol: "btc" })] },
      "_unknown",
    ],
  ])("refuses %s as invalid under key %s", (_label, raw, key) => {
    expect(checkBatch(raw, NOW, "dolarapi").refused.invalid).toEqual([key]);
  });

  it("refuses each unread part as invalid and lists it with its code", () => {
    const batch = checkBatch(
      {
        fxRates: [fx()],
        prices: [],
        unread: [
          { key: "blue", code: "http_5xx" },
          { key: "ccl", code: "http_4xx" },
        ],
      },
      NOW,
      "dolarapi",
    );
    expect(batch.fxRates).toHaveLength(1);
    expect(batch.refused.invalid).toEqual(["blue", "ccl"]);
    expect(batch.unread).toEqual(["blue:http_5xx", "ccl:http_4xx"]);
  });

  it("refuses Friday's dollar rate on Saturday as closed", () => {
    const batch = checkBatch(
      { fxRates: [fx({ rate_date: FRIDAY })], prices: [] },
      at("2026-10-10T18:05:00"),
      "dolarapi",
    );
    expect(batch.refused).toEqual({
      early: [],
      closed: ["mep"],
      stale: [],
      invalid: [],
    });
  });
});

describe("parseResponse", () => {
  const okSchema = z.object({ ok: z.boolean() });

  it("throws a bad_shape that is not retried", () => {
    expect(() => parseResponse(okSchema, { detail: "provider text" })).toThrow(
      expect.objectContaining({ code: "bad_shape", retryable: false }),
    );
  });

  it("returns the parsed value", () => {
    expect(parseResponse(okSchema, { ok: true })).toEqual({ ok: true });
  });
});

describe("the quote errors", () => {
  it.each([
    [
      "feed",
      QUOTE_FEED_CODES,
      [
        "fetch_error",
        "timeout",
        "http_429",
        "http_5xx",
        "provider_busy",
        "empty",
      ],
    ],
    ["store", QUOTE_STORE_CODES, ["timeout", "unavailable", "out_of_window"]],
  ] as const)(
    "retry only the %s codes a retry can help",
    (_label, codes, retryable) => {
      expect(
        Object.keys(codes).filter((code) => codes[code as keyof typeof codes]),
      ).toEqual(retryable);
    },
  );

  it.each(Object.keys(QUOTE_FEED_CODES) as (keyof typeof QUOTE_FEED_CODES)[])(
    "builds a QuoteFeedError %s with only its code as the message",
    (code) => {
      const error = new QuoteFeedError(code);
      expect(error).toBeInstanceOf(QuoteError);
      expect([error.message, error.code, error.retryable, error.name]).toEqual([
        code,
        code,
        QUOTE_FEED_CODES[code],
        QUOTE_FEED_ERROR_NAME,
      ]);
    },
  );

  it.each(Object.keys(QUOTE_STORE_CODES) as (keyof typeof QUOTE_STORE_CODES)[])(
    "builds a QuoteStoreError %s with only its code as the message",
    (code) => {
      const error = new QuoteStoreError(code, "23514");
      expect(error).toBeInstanceOf(QuoteError);
      expect([
        error.message,
        error.code,
        error.retryable,
        error.name,
        error.storeCode,
      ]).toEqual([
        code,
        code,
        QUOTE_STORE_CODES[code],
        QUOTE_STORE_ERROR_NAME,
        "23514",
      ]);
    },
  );
});

describe("quoteFailureOf", () => {
  const feedError = new QuoteFeedError("http_5xx");
  const storeError = new QuoteStoreError("out_of_window", "PT403");
  // What a serialized error keeps.
  const copy = ({ name, message }: Error) => ({ name, message });

  it.each([
    [
      "a feed error",
      feedError,
      { stage: "read", code: "http_5xx", known: true, retryable: true },
    ],
    [
      "a copy of a feed error",
      copy(feedError),
      { stage: "read", code: "http_5xx", known: true, retryable: true },
    ],
    [
      "a store error",
      storeError,
      { stage: "save", code: "out_of_window", known: true, retryable: true },
    ],
    [
      "a copy of a store error",
      copy(storeError),
      { stage: "save", code: "out_of_window", known: true, retryable: true },
    ],
    [
      "a store error that is not retried",
      new QuoteStoreError("invalid_row", "23514"),
      { stage: "save", code: "invalid_row", known: true, retryable: false },
    ],
    [
      "a store error name with another message",
      { name: QUOTE_STORE_ERROR_NAME, message: "provider text" },
      { stage: "save", code: "_OTHER", known: false, retryable: false },
    ],
    [
      "a feed error name with a store code",
      { name: QUOTE_FEED_ERROR_NAME, message: "unavailable" },
      { stage: "read", code: "_OTHER", known: false, retryable: false },
    ],
    [
      "a TypeError",
      new TypeError("boom"),
      { stage: "read", code: "_OTHER", known: false, retryable: false },
    ],
    [
      "an inherited name",
      { name: "toString", message: "http_5xx" },
      { stage: "read", code: "_OTHER", known: false, retryable: false },
    ],
    [
      "a string",
      "http_5xx",
      { stage: "read", code: "_OTHER", known: false, retryable: false },
    ],
    [
      "null",
      null,
      { stage: "read", code: "_OTHER", known: false, retryable: false },
    ],
  ])("reads %s", (_label, error, failure) => {
    expect(quoteFailureOf(error)).toEqual(failure);
  });
});

describe("feedErrorForStatus", () => {
  it.each([
    [400, "http_4xx", false],
    [403, "http_4xx", false],
    [404, "http_4xx", false],
    [429, "http_429", true],
    [499, "http_4xx", false],
    [500, "http_5xx", true],
    [503, "http_5xx", true],
    [599, "http_5xx", true],
  ])("maps %i to %s, retryable %s", (status, code, retryable) => {
    const error = feedErrorForStatus(status);
    expect(error).toBeInstanceOf(QuoteFeedError);
    expect([error.code, error.retryable]).toEqual([code, retryable]);
  });
});

describe("the quotes migrations", () => {
  const dir = join(__dirname, "../../../../../supabase/migrations");
  const readMigrations = () =>
    readdirSync(dir)
      .filter((file) => file.endsWith(".sql"))
      .map((file) => ({ file, sql: readFileSync(join(dir, file), "utf8") }));
  const tableSql = (table: string) => {
    const match = readMigrations()
      .map(({ sql }) =>
        sql.match(
          new RegExp(`CREATE TABLE public\\.${table} \\(([\\s\\S]*?)\\n\\);`),
        ),
      )
      .find(Boolean);
    if (!match?.[1]) throw new Error(`no CREATE TABLE for ${table}`);
    return match[1];
  };

  it("give prices.symbol the CHECK SYMBOL_PATTERN mirrors", () => {
    expect(tableSql("prices")).toContain(
      `CHECK (symbol ~ '${SYMBOL_PATTERN.source}')`,
    );
  });

  it.each([
    ["fx_rates", QUOTE_KEYS.fxRates],
    ["prices", QUOTE_KEYS.prices],
  ])("key %s by QUOTE_KEYS", (table, keys) => {
    expect(tableSql(table)).toContain(`PRIMARY KEY (${keys.join(", ")})`);
  });

  it("refuse a buying rate for exactly the daily indexes", () => {
    const kinds = [
      ...tableSql("fx_rates").matchAll(
        /CHECK \(kind <> '(\w+)' OR buy IS NULL\)/g,
      ),
    ].map((match) => match[1]);
    expect(kinds).toEqual(
      Constants.public.Enums.fx_rate_kind.filter(isDailyIndex),
    );
  });

  it("date the quote guards in BUENOS_AIRES_TZ", () => {
    const zones = readMigrations()
      .filter(({ sql }) => sql.includes("'PT403'"))
      .flatMap(({ sql }) =>
        [...sql.matchAll(/AT TIME ZONE '([^']+)'/g)].map((match) => match[1]),
      );
    expect(zones.length).toBeGreaterThanOrEqual(2);
    expect(new Set(zones)).toEqual(new Set([BUENOS_AIRES_TZ]));
  });
});
