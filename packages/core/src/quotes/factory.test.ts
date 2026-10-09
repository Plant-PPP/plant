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

  it("throws the first part's code when every part was unread", async () => {
    const feed = toQuoteFeed(
      raw(async () => ({
        fxRates: [],
        prices: [],
        unread: [
          { key: "blue", code: "http_4xx" },
          { key: "bolsa", code: "bad_json" },
        ],
      })),
    );
    await expect(feed.read(NOW)).rejects.toMatchObject({
      code: "http_4xx",
      retryable: false,
    });
  });

  it("throws bad_shape when the rows read were refused and the rest unread", async () => {
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
        unread: [{ key: "blue", code: "http_4xx" }],
      })),
    );
    await expect(feed.read(NOW)).rejects.toMatchObject({ code: "bad_shape" });
  });

  it("throws a retryable unread code when nothing else was kept", async () => {
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
        unread: [
          { key: "blue", code: "http_4xx" },
          { key: "bolsa", code: "http_5xx" },
        ],
      })),
    );
    await expect(feed.read(NOW)).rejects.toMatchObject({
      code: "http_5xx",
      retryable: true,
    });
  });

  it("keeps a read whose only row read is stale and the rest unread with a retryable code", async () => {
    const feed = toQuoteFeed(
      raw(async () => ({
        fxRates: [
          {
            kind: "blue",
            rate_date: "2026-10-08",
            buy: "1",
            sell: "2",
            quoted_at: "2026-10-08T20:00:00.000Z",
          },
        ],
        prices: [],
        unread: [
          { key: "official", code: "timeout" },
          { key: "mep", code: "timeout" },
          { key: "ccl", code: "http_5xx" },
        ],
      })),
    );
    const batch = await feed.read(NOW);
    expect([batch.fxRates, batch.refused.stale, batch.unread]).toEqual([
      [],
      ["blue"],
      ["official:timeout", "mep:timeout", "ccl:http_5xx"],
    ]);
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

  const feedOf = (
    id: string,
    override: (url: string) => unknown = () => undefined,
  ) => {
    const feed = quoteFeeds({
      getJson: async (url) => override(url) ?? answer(url),
    }).find((port) => port.id === id);
    if (!feed) throw new Error(`no feed ${id}`);
    return feed;
  };

  it("keeps the other houses and lists one that changed shape as unread", async () => {
    const batch = await feedOf("dolarapi", (url) =>
      url.endsWith("/blue") ? { compra: null } : undefined,
    ).read(NOW);
    expect(batch.fxRates.map((row) => row.kind)).toEqual([
      "official",
      "mep",
      "ccl",
    ]);
    expect(batch.unread).toEqual(["blue:bad_shape"]);
  });

  it.each([
    [
      "no entry up to today",
      [{ fecha: "2026-10-10", valor: 1 }],
      "empty",
      true,
    ],
    [
      "only an invalid row",
      [{ fecha: "2026-10-09", valor: 0 }],
      "bad_shape",
      false,
    ],
  ])(
    "fails an index series with %s as %s",
    async (_label, series, code, retryable) => {
      await expect(
        feedOf("argentinadatos", () => series).read(NOW),
      ).rejects.toMatchObject({ code, retryable });
    },
  );

  it.each([
    [
      "EService:Unavailable",
      { error: ["EService:Unavailable"] },
      "provider_busy",
      true,
    ],
    [
      "EQuery:Unknown asset pair",
      { error: ["EQuery:Unknown asset pair"] },
      "provider_error",
      false,
    ],
    ["no pair", { error: [], result: {} }, "bad_shape", false],
  ])(
    "fails a ticker answer with %s as %s",
    async (_label, body, code, retryable) => {
      await expect(
        feedOf("kraken", () => body).read(NOW),
      ).rejects.toMatchObject({ code, retryable });
    },
  );

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
