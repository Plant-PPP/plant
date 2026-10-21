import { Constants } from "@plant/shared";

import type { RawQuoteFeed } from "./contract/port";
import type { RawPrice } from "./contract/quote";
import { quoteFeeds, toQuoteFeed } from "./factory";

const NOW = new Date("2026-10-09T21:30:00.000Z");
const [SOURCE, , OTHER_SOURCE] = Constants.public.Enums.quote_source;

const raw = (readRaw: RawQuoteFeed["readRaw"]): RawQuoteFeed => ({
  id: SOURCE,
  listed: false,
  readRaw,
});

describe("toQuoteFeed", () => {
  it.each([
    [true, { closed: ["GGAL"], stale: [] }],
    [false, { closed: [], stale: ["GGAL"] }],
  ])(
    "reads Friday's price on Saturday by the feed's listed flag (%s)",
    async (listed, refused) => {
      const feed = toQuoteFeed({
        id: OTHER_SOURCE,
        listed,
        readRaw: async () => ({
          fxRates: [],
          prices: [
            {
              symbol: "GGAL",
              price_date: "2026-10-09",
              price: "7000",
              currency: "ARS",
              quoted_at: "2026-10-09T20:00:00.000Z",
            },
            {
              symbol: "BTC",
              price_date: "2026-10-10",
              price: "65000",
              currency: "USD",
              quoted_at: "2026-10-10T21:00:00.000Z",
            },
          ],
        }),
      });
      const batch = await feed.read(new Date("2026-10-10T21:30:00.000Z"));
      expect(batch.refused).toMatchObject(refused);
    },
  );

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
          { key: "mep", code: "bad_json" },
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
          { key: "mep", code: "http_5xx" },
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
      listed: false,
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
  const TOKEN = { access_token: "made-up-access", expires_in: 899 };
  const CREDENTIALS = { username: "plant-test", password: "made-up" };
  const CATALOG = [
    { symbol: "AAPL", type: "cedear", currency: "ARS" },
    { symbol: "BTC", type: "crypto", currency: "USD" },
    { symbol: "VOO.US", type: "etf", currency: "USD" },
  ] as const;
  const instruments = async () => CATALOG;

  it("builds one port per quote source", () => {
    const feeds = quoteFeeds({
      getJson: async () => null,
      postForm: async () => null,
      iol: null,
      instruments,
    });
    expect(feeds.map((feed) => feed.id).sort()).toEqual(
      [...Constants.public.Enums.quote_source].sort(),
    );
  });

  // Invented answers in each provider's shape, all dated today.
  const answer = (url: string): unknown => {
    const { hostname } = new URL(url);
    if (hostname === "api.invertironline.com") {
      return {
        titulos: [
          { simbolo: "AAPL", ultimoPrecio: 1, fecha: "2026-10-09T17:00:00" },
        ],
      };
    }
    if (hostname === "dolarapi.com") {
      return { compra: 1, venta: 2, fechaActualizacion: NOW.toISOString() };
    }
    if (hostname === "api.argentinadatos.com") {
      return [{ fecha: "2026-10-09", valor: 1603.33 }];
    }
    if (hostname === "query1.finance.yahoo.com") {
      return {
        spark: {
          result: [
            {
              symbol: "VOO",
              response: [
                {
                  meta: {
                    currency: "USD",
                    regularMarketPrice: 705.21,
                    regularMarketTime:
                      Date.parse("2026-10-09T20:00:00Z") / 1000,
                  },
                },
              ],
            },
          ],
        },
      };
    }
    if (hostname === "api.coingecko.com") {
      return {
        bitcoin: {
          usd: 1,
          last_updated_at: Date.parse(NOW.toISOString()) / 1000,
        },
      };
    }
    return { error: [], result: { XXBTZUSD: { c: ["1", "1"] } } };
  };

  const feedOf = (
    id: string,
    override: (url: string) => unknown = () => undefined,
  ) => {
    const feed = quoteFeeds({
      getJson: async (url) => override(url) ?? answer(url),
      postForm: async () => TOKEN,
      iol: CREDENTIALS,
      instruments,
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
      "eur",
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

  it("fails the IOL feed unconfigured without credentials", async () => {
    const feed = quoteFeeds({
      getJson: async (url) => answer(url),
      postForm: async () => TOKEN,
      iol: null,
      instruments,
    }).find((port) => port.id === "iol");
    await expect(feed?.read(NOW)).rejects.toMatchObject({
      code: "unconfigured",
      retryable: false,
    });
  });

  it("reads the catalog once for every feed that quotes from it", async () => {
    let reads = 0;
    const feeds = quoteFeeds({
      getJson: async (url) => answer(url),
      postForm: async () => TOKEN,
      iol: CREDENTIALS,
      instruments: async () => {
        reads += 1;
        return CATALOG;
      },
    });
    for (const feed of feeds) await feed.read(NOW);
    expect(reads).toBe(1);
  });

  it("reads the catalog again once it is five minutes old or failed", async () => {
    let reads = 0;
    let at = 0;
    const feeds = quoteFeeds({
      getJson: async (url) => answer(url),
      postForm: async () => TOKEN,
      iol: CREDENTIALS,
      instruments: async () => {
        reads += 1;
        if (reads === 2) throw new Error("down");
        return CATALOG;
      },
      now: () => at,
    });
    const yahoo = feeds.find((feed) => feed.id === "yahoo")!;
    await yahoo.read(NOW);
    at = 5 * 60_000 - 1;
    await yahoo.read(NOW);
    expect(reads).toBe(1);
    at = 5 * 60_000;
    await expect(yahoo.read(NOW)).rejects.toThrow("down");
    await yahoo.read(NOW);
    expect(reads).toBe(3);
  });

  it("quotes a US listing from Yahoo, never from IOL", async () => {
    const urls: string[] = [];
    const feeds = quoteFeeds({
      getJson: async (url) => {
        urls.push(url);
        return answer(url);
      },
      postForm: async () => TOKEN,
      iol: CREDENTIALS,
      instruments,
    });
    const read = async (id: string) =>
      (await feeds.find((feed) => feed.id === id)!.read(NOW)).prices.map(
        ({ symbol, price }) => [symbol, price],
      );
    expect(await read("yahoo")).toEqual([["VOO.US", "705.21"]]);
    expect(await read("iol")).toEqual([["AAPL", "1"]]);
    expect(
      urls
        .filter((url) => url.includes("VOO"))
        .every((url) => url.includes("yahoo")),
    ).toBe(true);
  });

  it("reads a feed with nothing to quote as idle, not empty", async () => {
    const feeds = quoteFeeds({
      getJson: async (url) => answer(url),
      postForm: async () => TOKEN,
      iol: CREDENTIALS,
      instruments: async () => [],
    });
    for (const id of ["yahoo", "iol", "kraken", "coingecko"]) {
      const batch = await feeds.find((feed) => feed.id === id)!.read(NOW);
      expect([batch.prices, batch.idle, batch.unread]).toEqual([[], true, []]);
    }
  });

  it("stamps every row with the feed that read it and the read instant", async () => {
    const feeds = quoteFeeds({
      getJson: async (url) => answer(url),
      postForm: async () => TOKEN,
      iol: CREDENTIALS,
      instruments,
    });
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
