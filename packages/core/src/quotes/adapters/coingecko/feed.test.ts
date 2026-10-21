import { toQuoteFeed } from "../../factory";
import { createCoingeckoFeed, parse, priceUrl } from "./feed";

// 2026-10-21 18:30 in Buenos Aires.
const NOW = new Date("2026-10-21T21:30:00Z");
const UPDATED = Math.floor(new Date("2026-10-21T21:29:00Z").getTime() / 1000);

describe("parse", () => {
  it("reads each symbol's dollar price, dated when CoinGecko updated it", () => {
    expect(
      parse(
        {
          nexo: { usd: 0.834133, last_updated_at: UPDATED },
          "shiba-inu": { usd: 0.0000123, last_updated_at: UPDATED },
        },
        NOW,
        ["NEXO", "SHIB", "ETH"],
      ),
    ).toEqual([
      {
        symbol: "NEXO",
        price_date: "2026-10-21",
        price: "0.834133",
        currency: "USD",
        quoted_at: "2026-10-21T21:29:00.000Z",
      },
      {
        symbol: "SHIB",
        price_date: "2026-10-21",
        price: "0.0000123",
        currency: "USD",
        quoted_at: "2026-10-21T21:29:00.000Z",
      },
      expect.objectContaining({ symbol: "ETH", price: "" }),
    ]);
  });
});

describe("createCoingeckoFeed", () => {
  it("asks once for the crypto it has an id for, and keeps today's prices", async () => {
    const getJson = jest.fn(async () => ({
      nexo: { usd: 0.83, last_updated_at: UPDATED },
    }));
    const feed = toQuoteFeed(
      createCoingeckoFeed(getJson, async () => ["NEXO", "UNKNOWNCOIN"]),
    );
    const batch = await feed.read(NOW);
    expect(getJson).toHaveBeenCalledWith(priceUrl(["nexo"]));
    expect(batch.prices).toEqual([
      expect.objectContaining({
        symbol: "NEXO",
        price: "0.83",
        source: "coingecko",
      }),
    ]);
  });

  it("idles with no crypto it knows", async () => {
    const getJson = jest.fn();
    const batch = await toQuoteFeed(
      createCoingeckoFeed(getJson, async () => ["UNKNOWNCOIN"]),
    ).read(NOW);
    expect(batch.idle).toBe(true);
    expect(getJson).not.toHaveBeenCalled();
  });
});
