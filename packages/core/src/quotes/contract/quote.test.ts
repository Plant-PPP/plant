import {
  checkBatch,
  dropStale,
  inQuoteWindow,
  type QuoteBatch,
  QuoteFeedError,
  type RawFxRate,
  type RawPrice,
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
  ])("counts %s as invalid", (_label, row) => {
    expect(counts(checkBatch({ fxRates: [row], prices: [] }, NOW))).toEqual({
      fxRates: 0,
      prices: 0,
      staleCount: 0,
      invalidCount: 1,
    });
  });

  it("compares buy and sell as decimals, not as text", () => {
    const batch = checkBatch(
      { fxRates: [fx({ buy: "999.99", sell: "1000" })], prices: [] },
      NOW,
    );
    expect(batch.fxRates).toHaveLength(1);
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

  it("counts an empty price as invalid", () => {
    const batch = checkBatch(
      { fxRates: [], prices: [price({ price: "" })] },
      NOW,
    );
    expect(batch.invalidCount).toBe(1);
  });

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

  it("keeps the last row per primary key", () => {
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
  });
});

describe("dropStale", () => {
  it("adds the rows it drops to the stale count", () => {
    const read = checkBatch({ fxRates: [fx()], prices: [price()] }, NOW);
    const nextDay = new Date("2026-10-10T21:30:00.000Z");
    expect(counts(dropStale({ ...read, staleCount: 1 }, nextDay))).toEqual({
      fxRates: 0,
      prices: 0,
      staleCount: 3,
      invalidCount: 0,
    });
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
