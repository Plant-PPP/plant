import { Constants } from "@plant/shared";

import type { RawQuoteFeed } from "./contract/port";
import { quoteFeeds, toQuoteFeed } from "./factory";

const NOW = new Date("2026-10-09T21:30:00.000Z");
const [SOURCE] = Constants.public.Enums.quote_source;

const raw = (readRaw: RawQuoteFeed["readRaw"]): RawQuoteFeed => ({
  id: SOURCE,
  readRaw,
});

describe("toQuoteFeed", () => {
  it("throws a retryable empty when a feed returned no rows", async () => {
    const feed = toQuoteFeed(raw(async () => ({ fxRates: [], prices: [] })));
    await expect(feed.read(NOW)).rejects.toMatchObject({
      name: "QuoteFeedError",
      code: "empty",
      retryable: true,
    });
  });

  it("passes any other error through", async () => {
    const bug = new TypeError("boom");
    const feed = toQuoteFeed(
      raw(async () => {
        throw bug;
      }),
    );
    await expect(feed.read(NOW)).rejects.toBe(bug);
  });

  it("checks the rows and carries the counts", async () => {
    const feed = toQuoteFeed(
      raw(async () => ({
        fxRates: [
          {
            kind: "uva",
            rate_date: "2026-10-09",
            buy: null,
            sell: "1603.33",
            source: SOURCE,
            quoted_at: "2026-10-09T03:00:00.000Z",
          },
          {
            kind: "uva",
            rate_date: "2026-10-08",
            buy: null,
            sell: "1602.22",
            source: SOURCE,
            quoted_at: "2026-10-08T03:00:00.000Z",
          },
        ],
        prices: [
          {
            symbol: "btc",
            price_date: "2026-10-09",
            price: "1",
            currency: "USD",
            source: SOURCE,
            quoted_at: NOW.toISOString(),
          },
        ],
      })),
    );
    const batch = await feed.read(NOW);
    expect(feed.id).toBe(SOURCE);
    expect(batch.fxRates.map((row) => row.rate_date)).toEqual(["2026-10-09"]);
    expect([batch.staleCount, batch.invalidCount]).toEqual([1, 1]);
  });
});

describe("quoteFeeds", () => {
  it("builds one port per quote source", () => {
    const feeds = quoteFeeds({ getJson: async () => null });
    expect(feeds.map((feed) => feed.id).sort()).toEqual(
      [...Constants.public.Enums.quote_source].sort(),
    );
  });
});
