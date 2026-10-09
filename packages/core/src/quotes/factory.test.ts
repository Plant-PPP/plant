import { Constants } from "@plant/shared";

import type { RawQuoteFeed } from "./contract/port";
import type { RawPrice } from "./contract/quote";
import { quoteFeeds, toQuoteFeed } from "./factory";

const NOW = new Date("2026-10-09T21:30:00.000Z");
const [SOURCE, , OTHER_SOURCE] = Constants.public.Enums.quote_source;

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

  it("throws bad_shape when every row is refused", async () => {
    const feed = toQuoteFeed(
      raw(async () => ({
        fxRates: [],
        prices: [
          {
            symbol: "BTC",
            price_date: "2026-10-09",
            price: "",
            currency: "USD",
            quoted_at: NOW.toISOString(),
          },
        ],
      })),
    );
    await expect(feed.read(NOW)).rejects.toMatchObject({
      code: "bad_shape",
      retryable: false,
    });
  });

  it("throws bad_shape when every part was unread or invalid", async () => {
    const feed = toQuoteFeed(
      raw(async () => ({
        fxRates: [],
        prices: [],
        unread: [{ key: "blue", code: "http_4xx" }],
      })),
    );
    await expect(feed.read(NOW)).rejects.toMatchObject({ code: "bad_shape" });
  });

  it("keeps a read whose rows are all early", async () => {
    const morning = new Date("2026-10-09T13:00:00.000Z");
    const feed = toQuoteFeed(
      raw(async () => ({
        fxRates: [
          {
            kind: "mep",
            rate_date: "2026-10-09",
            buy: "1",
            sell: "2",
            quoted_at: morning.toISOString(),
          },
        ],
        prices: [],
      })),
    );
    expect((await feed.read(morning)).refused.early).toEqual(["mep"]);
  });

  it("keeps a read whose rows are all stale", async () => {
    const feed = toQuoteFeed(
      raw(async () => ({
        fxRates: [
          {
            kind: "uva",
            rate_date: "2026-10-08",
            buy: null,
            sell: "1602.22",
            quoted_at: "2026-10-08T03:00:00.000Z",
          },
        ],
        prices: [],
      })),
    );
    const batch = await feed.read(NOW);
    expect([batch.fxRates.length, batch.refused.stale]).toEqual([0, ["uva"]]);
  });

  it("stamps its own id and the read instant over what a row carries", async () => {
    const carried = {
      symbol: "BTC",
      price_date: "2026-10-09",
      price: "1",
      currency: "USD",
      quoted_at: NOW.toISOString(),
      source: SOURCE,
      fetched_at: "2020-01-01T00:00:00.000Z",
    } as RawPrice;
    const feed = toQuoteFeed({
      id: OTHER_SOURCE,
      readRaw: async () => ({ fxRates: [], prices: [carried] }),
    });
    const batch = await feed.read(NOW);
    expect(batch.prices.map((row) => [row.source, row.fetched_at])).toEqual([
      [OTHER_SOURCE, NOW.toISOString()],
    ]);
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
            quoted_at: "2026-10-09T03:00:00.000Z",
          },
          {
            kind: "uva",
            rate_date: "2026-10-08",
            buy: null,
            sell: "1602.22",
            quoted_at: "2026-10-08T03:00:00.000Z",
          },
        ],
        prices: [
          {
            symbol: "btc",
            price_date: "2026-10-09",
            price: "1",
            currency: "USD",
            quoted_at: NOW.toISOString(),
          },
        ],
      })),
    );
    const batch = await feed.read(NOW);
    expect(feed.id).toBe(SOURCE);
    expect(batch.fxRates.map((row) => row.rate_date)).toEqual(["2026-10-09"]);
    expect(batch.refused).toMatchObject({
      stale: ["uva"],
      invalid: ["_unknown"],
    });
  });

  // Far from the wall clock, so only the read instant can put the rows in the
  // window.
  const LATER = new Date("2031-03-14T21:30:00.000Z");
  it.each([
    [
      "a price",
      {
        fxRates: [],
        prices: [
          {
            symbol: "BTC",
            price_date: "2031-03-14",
            price: "1",
            currency: "USD" as const,
            quoted_at: LATER.toISOString(),
          },
        ],
      },
    ],
    [
      "a dollar rate",
      {
        fxRates: [
          {
            kind: "mep" as const,
            rate_date: "2031-03-14",
            buy: "0.5",
            sell: "1",
            quoted_at: LATER.toISOString(),
          },
        ],
        prices: [],
      },
    ],
  ])("returns a read that kept only %s", async (_label, rows) => {
    const batch = await toQuoteFeed(raw(async () => rows)).read(LATER);
    expect(batch.fxRates.length + batch.prices.length).toBe(1);
    expect(Object.values(batch.refused).flat()).toEqual([]);
  });
});

describe("quoteFeeds", () => {
  it("builds one port per quote source", () => {
    const feeds = quoteFeeds({ getJson: async () => null });
    expect(feeds.map((feed) => feed.id).sort()).toEqual(
      [...Constants.public.Enums.quote_source].sort(),
    );
  });

  // Invented answers in each provider's shape, all dated today.
  const answer = (url: string): unknown => {
    const { hostname } = new URL(url);
    if (hostname === "dolarapi.com") {
      return { compra: 1, venta: 2, fechaActualizacion: NOW.toISOString() };
    }
    if (hostname === "api.argentinadatos.com") {
      return [{ fecha: "2026-10-09", valor: 1603.33 }];
    }
    return { error: [], result: { XXBTZUSD: { c: ["1", "1"] } } };
  };

  it("stamps every row with the feed that read it and the read instant", async () => {
    const feeds = quoteFeeds({ getJson: async (url) => answer(url) });
    for (const feed of feeds) {
      const batch = await feed.read(NOW);
      const rows = [...batch.fxRates, ...batch.prices];
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.map((row) => [row.source, row.fetched_at])).toEqual(
        rows.map(() => [feed.id, NOW.toISOString()]),
      );
    }
  });
});
