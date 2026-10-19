import type { GetJson } from "../../contract/port";
import { QuoteFeedError } from "../../contract/quote";
import { createYahooFeed, parseSpark, sparkUrl } from "./feed";

// 2026-10-19 18:30 in Buenos Aires; VOO last traded at 17:00 there.
const NOW = new Date("2026-10-19T21:30:00.000Z");
const TRADED = Date.parse("2026-10-19T20:00:00.000Z") / 1000;

// A spark answer in Yahoo's shape (recorded 2026-10-19, cut to what Plant
// reads): a ticker Yahoo does not know is left out.
const spark = (
  quotes: Record<string, { price: number; currency?: string; time?: number }>,
) => ({
  spark: {
    result: Object.entries(quotes).map(([symbol, quote]) => ({
      symbol,
      response: [
        {
          meta: {
            currency: quote.currency ?? "USD",
            regularMarketPrice: quote.price,
            regularMarketTime: quote.time ?? TRADED,
          },
        },
      ],
    })),
    error: null,
  },
});

const row = (symbol: string, price: string) => ({
  symbol,
  price_date: "2026-10-19",
  price,
  currency: "USD",
  quoted_at:
    price === "" ? NOW.toISOString() : new Date(TRADED * 1000).toISOString(),
});

describe("parseSpark", () => {
  it("prices each symbol at its last regular-session trade", () => {
    expect(
      parseSpark(
        spark({ VOO: { price: 705.213 }, "BRK-B": { price: 532.45 } }),
        ["BRK-B.US", "VOO.US"],
        NOW,
      ),
    ).toEqual([row("BRK-B.US", "532.45"), row("VOO.US", "705.213")]);
  });

  it("refuses a symbol missing from the answer or not in dollars", () => {
    expect(
      parseSpark(
        spark({ SAP: { price: 200, currency: "EUR" } }),
        ["SAP.US", "NOPE.US"],
        NOW,
      ).map(({ price }) => price),
    ).toEqual(["", ""]);
  });

  it("dates a Friday close on a Saturday as Friday", () => {
    const friday = Date.parse("2026-10-16T20:00:00.000Z") / 1000;
    expect(
      parseSpark(
        spark({ VOO: { price: 700, time: friday } }),
        ["VOO.US"],
        NOW,
      )[0]?.price_date,
    ).toBe("2026-10-16");
  });

  it("refuses an answer of another shape", () => {
    expect(() => parseSpark({ VOO: { close: [1] } }, ["VOO.US"], NOW)).toThrow(
      "bad_shape",
    );
  });
});

describe("createYahooFeed", () => {
  const feedOver = (
    symbols: readonly string[],
    answer: (tickers: string[]) => unknown,
  ) => {
    const asked: string[][] = [];
    const getJson: GetJson = async (url, options) => {
      expect(options?.headers?.["User-Agent"]).toBe("Plant/1.0");
      const tickers = decodeURIComponent(
        /symbols=([^&]*)/.exec(url)?.[1] ?? "",
      ).split(",");
      asked.push(tickers);
      return answer(tickers);
    };
    return { feed: createYahooFeed(getJson, async () => symbols), asked };
  };

  it("asks for at most 20 tickers at a time, in order", async () => {
    const symbols = Array.from(
      { length: 45 },
      (_, i) => `T${String(i).padStart(2, "0")}.US`,
    );
    const { feed, asked } = feedOver(symbols, (tickers) =>
      spark(Object.fromEntries(tickers.map((t) => [t, { price: 1 }]))),
    );
    const rows = await feed.readRaw(NOW);
    expect(asked.map((tickers) => tickers.length)).toEqual([20, 20, 5]);
    expect(rows.prices).toHaveLength(45);
    expect(rows.unread).toEqual([]);
  });

  it("asks each ticker alone when Yahoo knows none of a request's", async () => {
    const { feed, asked } = feedOver(["GONE.US", "VOO.US"], (tickers) => {
      if (!tickers.includes("VOO")) throw new QuoteFeedError("http_404");
      return tickers.length === 1
        ? spark({ VOO: { price: 705 } })
        : (() => {
            throw new QuoteFeedError("http_404");
          })();
    });
    const rows = await feed.readRaw(NOW);
    expect(asked).toEqual([["GONE", "VOO"], ["GONE"], ["VOO"]]);
    expect(rows.prices.map(({ symbol, price }) => [symbol, price])).toEqual([
      ["GONE.US", ""],
      ["VOO.US", "705"],
    ]);
  });

  it("stops asking once Yahoo limits it, leaving the rest unread", async () => {
    const symbols = Array.from(
      { length: 45 },
      (_, i) => `T${String(i).padStart(2, "0")}.US`,
    );
    const { feed, asked } = feedOver(symbols, () => {
      throw new QuoteFeedError("http_429");
    });
    const rows = await feed.readRaw(NOW);
    expect(asked).toHaveLength(1);
    expect(rows.unread).toHaveLength(45);
    expect(rows.unread?.every(({ code }) => code === "http_429")).toBe(true);
  });

  it("is idle when the catalog holds no US listing", async () => {
    const { feed, asked } = feedOver([], () => null);
    expect(await feed.readRaw(NOW)).toEqual({
      fxRates: [],
      prices: [],
      idle: true,
    });
    expect(asked).toEqual([]);
  });

  it("names class shares as Yahoo does", () => {
    expect(sparkUrl(["BRK-B", "VOO"])).toContain("symbols=BRK-B,VOO&");
  });
});
