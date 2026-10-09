import { createKrakenFeed, parse } from "./feed";

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

const PRICES = [
  ["BTC", "112345.10000"],
  ["ETH", "4012.34"],
  ["SOL", "201.5"],
  ["USDT", "1.00010000"],
  ["USDC", "0.99990000"],
];

describe("kraken parse", () => {
  it("maps each pair to a USD price dated today", () => {
    const rows = parse(BODY, NOW);
    expect(rows.fxRates).toEqual([]);
    expect(rows.prices.map((row) => [row.symbol, row.price])).toEqual(PRICES);
    expect(rows.prices[0]).toEqual({
      symbol: "BTC",
      price_date: "2026-10-09",
      price: "112345.10000",
      currency: "USD",
      quoted_at: NOW.toISOString(),
    });
  });

  it("leaves a pair missing from the answer with an empty price", () => {
    const result: Record<string, unknown> = { ...BODY.result };
    delete result.XETHZUSD;
    const rows = parse({ error: [], result }, NOW);
    expect(rows.prices.find((row) => row.symbol === "ETH")?.price).toBe("");
  });

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
      NOW,
    );
    expect(rows.prices.map((row) => [row.symbol, row.price])).toEqual([
      ["BTC", "100.5"],
      ["ETH", ""],
      ["SOL", ""],
      ["USDT", ""],
      ["USDC", ""],
    ]);
  });

  it("does not read a pair through a __proto__ key", () => {
    const json: unknown = JSON.parse(
      '{"error":[],"result":{"__proto__":{"c":["9","9"],"XXBTZUSD":{"c":["9","9"]}}}}',
    );
    const rows = parse(json, NOW);
    expect(rows.prices.map((row) => row.price)).toEqual(["", "", "", "", ""]);
    expect(Object.prototype).not.toHaveProperty("c");
  });

  it("leaves every price empty when the answer has no result", () => {
    const rows = parse({ error: [] }, NOW);
    expect(rows.prices.map((row) => row.price)).toEqual(["", "", "", "", ""]);
  });

  it("keeps the prices when Kraken sends only a warning", () => {
    const rows = parse({ ...BODY, error: ["WGeneral:Deprecated"] }, NOW);
    expect(rows.prices.map((row) => [row.symbol, row.price])).toEqual(PRICES);
  });

  it.each([
    ["EService:Unavailable", true],
    ["EAPI:Rate limit exceeded", true],
    ["EGeneral:Temporary lockout", true],
    ["EGeneral:Internal error", true],
    ["EGeneral:Too many requests", true],
    ["EQuery:Unknown asset pair", false],
    ["EQuery:Unknown asset pair:WBTCUSD", false],
    ["eService:Unavailable", false],
    ["EGeneral:Invalid arguments", false],
    ["Unavailable", false],
  ])("throws on %s, retryable %s", (error, retryable) => {
    expect(() => parse({ error: [error] }, NOW)).toThrow(
      expect.objectContaining({
        code: retryable ? "provider_busy" : "provider_error",
        retryable,
      }),
    );
  });

  it.each([
    [["EService:Unavailable", "EQuery:Unknown asset pair"], false],
    [["WGeneral:Deprecated", "EService:Unavailable"], true],
    [["EQuery:Unknown asset pair EService:Unavailable"], false],
  ])("throws on %j, retryable %s", (error, retryable) => {
    expect(() => parse({ error }, NOW)).toThrow(
      expect.objectContaining({
        code: retryable ? "provider_busy" : "provider_error",
        retryable,
      }),
    );
  });

  it("dates the prices by the Buenos Aires day", () => {
    const lateEvening = new Date("2026-10-10T01:00:00.000Z");
    const rows = parse(BODY, lateEvening);
    expect(rows.prices.map((row) => row.price_date)).toEqual(
      Array(5).fill("2026-10-09"),
    );
  });

  it.each([
    ["a numeric price", { error: [], result: { XXBTZUSD: { c: [1, "1"] } } }],
    [
      "a last trade with no volume",
      { error: [], result: { XXBTZUSD: { c: ["1"] } } },
    ],
    ["no error list", { result: {} }],
    ["a non-string error", { error: [{ detail: "x" }] }],
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
