import { createKrakenFeed, parse } from "./feed";

describe("kraken parse edges", () => {
  const now = new Date("2026-10-09T21:30:00.000Z");

  it("ignores unknown keys and pairs it did not ask for", () => {
    const rows = parse(
      {
        error: [],
        extra: { anything: 1 },
        result: {
          XXBTZUSD: { c: ["100.5", "1"], z: "unknown" },
          DOGEUSD: { c: ["0.1", "1"] },
        },
      },
      now,
    );
    expect(rows.prices.map((row) => [row.symbol, row.price])).toEqual([
      ["BTC", "100.5"],
      ["ETH", ""],
      ["SOL", ""],
      ["USDT", ""],
      ["USDC", ""],
    ]);
  });
});

const NOW = new Date("2026-10-09T21:30:00.000Z");

const ticker = (last: string) => ({ a: ["1", "1", "1"], c: [last, "0.001"] });

// Invented values in the shape of /0/public/Ticker.
const BODY = {
  error: [],
  result: {
    XXBTZUSD: ticker("112345.10000"),
    XETHZUSD: ticker("4012.34"),
    SOLUSD: ticker("201.5"),
    USDTZUSD: ticker("1.00010000"),
    USDCUSD: ticker("0.99990000"),
  },
};

describe("kraken parse", () => {
  it("maps each pair to a USD price dated today", () => {
    const rows = parse(BODY, NOW);
    expect(rows.fxRates).toEqual([]);
    expect(rows.prices.map((row) => [row.symbol, row.price])).toEqual([
      ["BTC", "112345.10000"],
      ["ETH", "4012.34"],
      ["SOL", "201.5"],
      ["USDT", "1.00010000"],
      ["USDC", "0.99990000"],
    ]);
    expect(rows.prices[0]).toEqual({
      symbol: "BTC",
      price_date: "2026-10-09",
      price: "112345.10000",
      currency: "USD",
      source: "kraken",
      quoted_at: NOW.toISOString(),
    });
  });

  it("leaves a pair missing from the answer with an empty price", () => {
    const result: Record<string, unknown> = { ...BODY.result };
    delete result.XETHZUSD;
    const rows = parse({ error: [], result }, NOW);
    expect(rows.prices.find((row) => row.symbol === "ETH")?.price).toBe("");
  });

  it("throws a retryable provider_error when Kraken reports one", () => {
    expect(() => parse({ error: ["EService:Unavailable"] }, NOW)).toThrow(
      expect.objectContaining({ code: "provider_error", retryable: true }),
    );
  });

  it.each([
    ["a numeric price", { error: [], result: { XXBTZUSD: { c: [1, "1"] } } }],
    ["no error list", { result: {} }],
  ])("throws bad_shape on %s", (_label, json) => {
    expect(() => parse(json, NOW)).toThrow(
      expect.objectContaining({ code: "bad_shape", retryable: false }),
    );
  });
});

describe("createKrakenFeed", () => {
  it("asks for every pair in one request", async () => {
    const urls: string[] = [];
    const feed = createKrakenFeed(async (url) => {
      urls.push(url);
      return BODY;
    });
    await feed.readRaw(NOW);
    expect(feed.id).toBe("kraken");
    expect(urls).toEqual([
      "https://api.kraken.com/0/public/Ticker?pair=XBTUSD,ETHUSD,SOLUSD,USDTUSD,USDCUSD",
    ]);
  });
});

describe("kraken parse on a hostile answer", () => {
  it("does not read a pair through a __proto__ key", () => {
    const json: unknown = JSON.parse(
      '{"error":[],"result":{"__proto__":{"c":["9","9"],"XXBTZUSD":{"c":["9","9"]}}}}',
    );
    const rows = parse(json, NOW);
    expect(rows.prices.map((row) => row.price)).toEqual(["", "", "", "", ""]);
    expect(Object.prototype).not.toHaveProperty("c");
  });

  it("keeps Kraken's error text out of the message", () => {
    expect(() => parse({ error: ["EGeneral:secret detail"] }, NOW)).toThrow(
      expect.objectContaining({ message: "provider_error" }),
    );
  });

  it("throws bad_shape on a non-string error", () => {
    expect(() => parse({ error: [{ detail: "x" }] }, NOW)).toThrow(
      expect.objectContaining({ code: "bad_shape" }),
    );
  });
});
