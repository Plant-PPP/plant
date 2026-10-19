import type { GetJson } from "../quotes/contract/port";
import { QuoteFeedError } from "../quotes/contract/quote";
import { marketSearch } from "./factory";
import {
  coinGeckoListings,
  exactListing,
  type Listing,
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

// Yahoo's search answer for VOO, cut to what Plant reads.
const YAHOO_VOO = {
  quotes: [
    {
      symbol: "VOO",
      longname: "Vanguard S&P 500 ETF",
      quoteType: "ETF",
      exchange: "PCX",
    },
    {
      symbol: "VOOG",
      longname: "Vanguard S&P 500 Growth ETF",
      quoteType: "ETF",
      exchange: "PCX",
    },
    {
      symbol: "VOO.MX",
      longname: "Vanguard S&P 500 ETF",
      quoteType: "ETF",
      exchange: "MEX",
    },
  ],
};

function transport(
  overrides: {
    panel?: () => unknown;
    coins?: () => unknown;
    pairs?: () => unknown;
    yahoo?: (url: string) => unknown;
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
    if (url.startsWith("https://query1.finance.yahoo.com/")) {
      if (overrides.yahoo) return overrides.yahoo(url);
      return url.includes("q=VOO&") ? YAHOO_VOO : { quotes: [] };
    }
    if (overrides.panel) return overrides.panel();
    const panel = /Cotizaciones\/(\w+)\//.exec(url)?.[1] ?? "";
    return { titulos: PANEL_LINES[panel] ?? [] };
  };
  return { getJson, urls };
}

const searchWith = (t: ReturnType<typeof transport>, now = () => 0) =>
  marketSearch({
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
        lines: ["GD30D"],
      },
    ]);
  });

  it("reads the panels' currency codes: 1 is pesos, 2 is a dollar line", () => {
    expect(
      panelListings("cedear", [
        { simbolo: "NU", descripcion: "Cedear Nu Holdings", moneda: "1" },
        { simbolo: "NUD", descripcion: "Cedear Nu Holdings", moneda: "2" },
      ]),
    ).toEqual([
      {
        symbol: "NU",
        name: "Cedear Nu Holdings",
        type: "cedear",
        currency: "ARS",
        market: "byma",
        lines: ["NUD"],
      },
    ]);
  });

  it("finds a CEDEAR by a dollar line IOL names its own way", () => {
    // As IOL lists them: GOOGL's lines under Google's old name and a
    // shorter symbol, IBIT's under a description cut differently.
    const listings = panelListings("cedear", [
      { simbolo: "GOGLC", descripcion: "Cedear Google Inc.", moneda: "2" },
      { simbolo: "GOGLD", descripcion: "Cedear Google Inc.", moneda: "2" },
      {
        simbolo: "GOOGL",
        descripcion: "Cedear Alphabet Inc. Cl. A",
        moneda: "1",
      },
      {
        simbolo: "IBIT",
        descripcion: "Cedear Ishares Bitcoin Tr (Ibi",
        moneda: "1",
      },
      {
        simbolo: "IBITD",
        descripcion: "Cedear Ishares Bitcoin Tr",
        moneda: "2",
      },
    ]);
    const found = (query: string) =>
      matchListings(listings, query, 5).map(({ symbol }) => symbol);
    expect(found("gogld")).toEqual(["GOOGL"]);
    expect(found("ibitd")[0]).toBe("IBIT");
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
  it("searches every market together", async () => {
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
    expect(found.failed).toEqual([{ market: "byma", code: "http_5xx" }]);
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

  it("finds a US listing by its ticker or its catalog symbol", async () => {
    const t = transport();
    const search = searchWith(t);
    for (const query of ["VOO", "VOO.US"]) {
      const { listings } = await search.search(query, 5, ["us"]);
      expect(listings[0]).toEqual({
        symbol: "VOO.US",
        name: "Vanguard S&P 500 ETF",
        type: "etf",
        currency: "USD",
        market: "us",
      });
    }
    expect(t.urls.every((url) => url.includes("?q=VOO&"))).toBe(true);
  });

  it("verifies a US listing against Yahoo's own", async () => {
    const t = transport();
    const search = searchWith(t);
    await expect(search.verify("VOO.US", "us")).resolves.toMatchObject({
      symbol: "VOO.US",
      type: "etf",
    });
    await expect(search.verify("VOOX.US", "us")).resolves.toBeNull();
    await expect(search.verify("VOO", "us")).resolves.toBeNull();
    await expect(search.verify("VOO.US", "byma")).resolves.toBeNull();
    await expect(search.verify("voo.us", "us")).resolves.toBeNull();
  });

  it("names the code a market failed with", async () => {
    const found = await searchWith(
      transport({
        yahoo: () => {
          throw new QuoteFeedError("http_429");
        },
      }),
    ).search("bitcoin", 5, ["us", "crypto"]);
    expect(found.failed).toEqual([{ market: "us", code: "http_429" }]);
  });
});

describe("exactListing", () => {
  const listing = (
    symbol: string,
    type: Listing["type"],
    lines?: string[],
  ): Listing => ({
    symbol,
    name: symbol,
    type,
    currency: "ARS",
    market: "byma",
    ...(lines && { lines }),
  });
  const googl = listing("GOOGL", "cedear", ["GOGLD", "GOGLC"]);

  it("finds a listing by its symbol or a dollar line", () => {
    expect(exactListing([googl], "gogld")).toEqual({
      listing: googl,
      line: "D",
    });
    expect(exactListing([googl], "GOGLC")).toEqual({
      listing: googl,
      line: "C",
    });
    expect(exactListing([googl], "GOOGL")).toEqual({
      listing: googl,
      line: null,
    });
    expect(exactListing([googl], "GOOG")).toBeNull();
  });

  it("reads a bond's D line as the bond in dollars", () => {
    const al30 = listing("AL30", "bond");
    expect(exactListing([al30], "AL30D")).toEqual({ listing: al30, line: "D" });
    expect(exactListing([listing("GGAL", "stock")], "GGALD")).toBeNull();
  });

  it("never takes a bare symbol for a US listing that reads the same", () => {
    const aus = listing("AUS", "stock");
    const agilent = { ...listing("A.US", "stock"), market: "us" as const };
    expect(exactListing([aus, agilent], "A.US")).toEqual({
      listing: agilent,
      line: null,
    });
    expect(exactListing([aus], "A.US")).toBeNull();
    expect(exactListing([agilent], "A")).toBeNull();
  });
});

describe("matchListings for US listings", () => {
  it("ranks a ticker's US listing first", () => {
    const listings: Listing[] = [
      {
        symbol: "VOOG.US",
        name: "Vanguard Growth",
        type: "etf",
        currency: "USD",
        market: "us",
      },
      {
        symbol: "VOO.US",
        name: "Vanguard S&P 500 ETF",
        type: "etf",
        currency: "USD",
        market: "us",
      },
      {
        symbol: "BRK-B.US",
        name: "Berkshire Hathaway",
        type: "stock",
        currency: "USD",
        market: "us",
      },
    ];
    expect(
      matchListings(listings, "VOO", 5).map(({ symbol }) => symbol),
    ).toEqual(["VOO.US", "VOOG.US"]);
    expect(
      matchListings(listings, "brk b", 5).map(({ symbol }) => symbol),
    ).toEqual(["BRK-B.US"]);
  });
});
