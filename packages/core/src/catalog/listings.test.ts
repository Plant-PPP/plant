import type { GetJson } from "../quotes/contract/port";
import { QuoteFeedError } from "../quotes/contract/quote";
import {
  coinGeckoListings,
  createCatalogSearch,
  matchListings,
  panelListings,
} from "./listings";

// Invented lines in the shape of IOL's panels and CoinGecko's search.
const line = (
  simbolo: string,
  descripcion: string,
  moneda = "peso_Argentino",
) => ({
  simbolo,
  descripcion,
  moneda,
  ultimoPrecio: 1,
});

const PANEL_LINES: Record<string, unknown[]> = {
  cedears: [
    line("GOOGL", "Cedear Alphabet Inc."),
    line("KO", "Cedear Coca-Cola"),
  ],
  acciones: [line("GGAL", "Grupo Financiero Galicia")],
  titulosPublicos: [
    line("AL30", "Bonar 2030"),
    line("GD30", "Global 2030"),
    line("GD30D", "Global 2030", "dolar_Estadounidense"),
  ],
  obligacionesNegociables: [line("YCA6O", "YPF 2026")],
  letras: [],
};

const COINS = {
  coins: [
    { name: "Bitcoin Cash", symbol: "bch", market_cap_rank: 20 },
    { name: "Bitcoin", symbol: "btc", market_cap_rank: 1 },
    { name: "Wrapped Bitcoin", symbol: "wbtc", market_cap_rank: null },
  ],
};

// Kraken's dollar pairs: Bitcoin and Bitcoin Cash, not Wrapped Bitcoin.
const KRAKEN_PAIRS = {
  error: [],
  result: {
    XXBTZUSD: { wsname: "XBT/USD" },
    BCHUSD: { wsname: "BCH/USD" },
    BCHEUR: { wsname: "BCH/EUR" },
    WBTCXBT: { wsname: "WBTC/XBT" },
  },
};

function transport(
  overrides: {
    panel?: () => unknown;
    coins?: () => unknown;
    pairs?: () => unknown;
  } = {},
) {
  const urls: string[] = [];
  const getJson: GetJson = async (url) => {
    urls.push(url);
    if (url.startsWith("https://api.coingecko.com/")) {
      return overrides.coins ? overrides.coins() : COINS;
    }
    if (url.startsWith("https://api.kraken.com/")) {
      return overrides.pairs ? overrides.pairs() : KRAKEN_PAIRS;
    }
    if (overrides.panel) return overrides.panel();
    const panel = /Cotizaciones\/(\w+)\//.exec(url)?.[1] ?? "";
    return { titulos: PANEL_LINES[panel] ?? [] };
  };
  return { getJson, urls };
}

const searchWith = (t: ReturnType<typeof transport>, now = () => 0) =>
  createCatalogSearch({
    getJson: t.getJson,
    postForm: async () => ({ access_token: "made-up-access", expires_in: 899 }),
    iol: { username: "plant-test", password: "made-up" },
    now,
  });

describe("panelListings", () => {
  it("lists peso lines by type, and a bond with a dollar line in dollars", () => {
    expect(panelListings("bond", PANEL_LINES.titulosPublicos!)).toEqual([
      {
        symbol: "AL30",
        name: "Bonar 2030",
        type: "bond",
        currency: "ARS",
        market: "byma",
      },
      {
        symbol: "GD30",
        name: "Global 2030",
        type: "bond",
        currency: "USD",
        market: "byma",
      },
    ]);
  });

  it("skips a symbol the catalog cannot hold and a malformed line", () => {
    expect(
      panelListings("stock", [
        line("BAD.SYM", "x"),
        { simbolo: 1 },
        line("YPFD", ""),
      ]),
    ).toEqual([
      {
        symbol: "YPFD",
        name: "YPFD",
        type: "stock",
        currency: "ARS",
        market: "byma",
      },
    ]);
  });
});

describe("coinGeckoListings", () => {
  it("lists coins in dollars by market cap rank", () => {
    expect(coinGeckoListings(COINS).map(({ symbol }) => symbol)).toEqual([
      "BTC",
      "BCH",
      "WBTC",
    ]);
  });
});

describe("matchListings", () => {
  const listings = [
    ...panelListings("cedear", PANEL_LINES.cedears!),
    ...coinGeckoListings(COINS),
  ];

  it("finds an instrument by its name, as a search would", () => {
    expect(matchListings(listings, "google", 5)).toEqual([]);
    expect(
      matchListings(listings, "alphabet", 5).map(({ symbol }) => symbol),
    ).toEqual(["GOOGL"]);
  });

  it("ranks an exact symbol first, then symbols that start with the query", () => {
    expect(
      matchListings(listings, "btc", 5).map(({ symbol }) => symbol),
    ).toEqual(["BTC", "WBTC"]);
  });

  it("finds a CEDEAR by its dollar line", () => {
    expect(
      matchListings(listings, "googld", 5).map(({ symbol }) => symbol),
    ).toEqual(["GOOGL"]);
    expect(
      matchListings(listings, "KOC", 5).map(({ symbol }) => symbol),
    ).toEqual(["KO"]);
  });

  it("finds nothing for a query with no letters or digits", () => {
    expect(matchListings(listings, " - ", 5)).toEqual([]);
  });
});

describe("createCatalogSearch", () => {
  it("searches BYMA and crypto together", async () => {
    const { listings: found } = await searchWith(transport()).search(
      "goog",
      10,
    );
    expect(found.map(({ symbol, market }) => [symbol, market])).toEqual([
      ["GOOGL", "byma"],
    ]);
  });

  it("reads the panels once while they are fresh", async () => {
    const t = transport();
    let at = 0;
    const search = searchWith(t, () => at);
    await search.search("ko", 5);
    await search.search("ggal", 5);
    const panelReads = () =>
      t.urls.filter((url) => url.includes("invertironline")).length;
    expect(panelReads()).toBe(5);
    at = 7 * 60 * 60_000;
    await search.search("ko", 5);
    expect(panelReads()).toBe(10);
  });

  it("keeps crypto results when IOL fails, and says BYMA failed", async () => {
    const found = await searchWith(
      transport({
        panel: () => {
          throw new QuoteFeedError("http_5xx");
        },
      }),
    ).search("bitcoin", 5);
    expect(found.failed).toEqual(["byma"]);
    expect(found.listings.map(({ symbol }) => symbol)).toEqual(["BTC", "BCH"]);
  });

  it("offers only the coins Kraken quotes in dollars", async () => {
    const { listings } = await searchWith(transport()).search("bitcoin", 5, [
      "crypto",
    ]);
    expect(listings.map(({ symbol }) => symbol)).toEqual(["BTC", "BCH"]);
  });

  it("searches only the markets asked for", async () => {
    const t = transport();
    const { listings } = await searchWith(t).search("ko", 5, ["byma"]);
    expect(listings.map(({ symbol }) => symbol)).toEqual(["KO"]);
    expect(t.urls.some((url) => url.includes("coingecko"))).toBe(false);
  });

  it("fails when every market asked for fails", async () => {
    await expect(
      searchWith(
        transport({
          panel: () => {
            throw new QuoteFeedError("http_5xx");
          },
        }),
      ).search("ko", 5, ["byma"]),
    ).rejects.toMatchObject({ code: "http_5xx" });
  });

  it("verifies a BYMA symbol against IOL's own listing", async () => {
    const search = searchWith(transport());
    await expect(search.verify("GGAL", "byma")).resolves.toMatchObject({
      symbol: "GGAL",
      type: "stock",
    });
    await expect(search.verify("NOPE", "byma")).resolves.toBeNull();
  });

  it("verifies a crypto only when Kraken quotes it in dollars", async () => {
    await expect(
      searchWith(transport()).verify("BTC", "crypto"),
    ).resolves.toMatchObject({
      symbol: "BTC",
      name: "Bitcoin",
    });
    await expect(
      searchWith(
        transport({ pairs: () => ({ error: [], result: {} }) }),
      ).verify("BTC", "crypto"),
    ).resolves.toBeNull();
  });

  it("refuses a symbol the catalog cannot hold without asking anyone", async () => {
    const t = transport();
    await expect(searchWith(t).verify("bad sym", "crypto")).resolves.toBeNull();
    expect(t.urls).toEqual([]);
  });
});
