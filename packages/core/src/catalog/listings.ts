import { type Currency, LOCAL_SYMBOL_PATTERN, usTicker } from "@plant/shared";
import { z } from "zod";

import { expiring } from "../expiring";
import {
  type DollarLine,
  dollarLineOf,
  type InstrumentType,
  normalizeSymbol,
  symbolKey,
} from "../instruments";
import {
  createIolSession,
  type IolCredentials,
  MONEDA,
  PANELS,
  readPanel,
} from "../quotes/adapters/iol/feed";
import type { GetJson, PostForm } from "../quotes/contract/port";
import {
  feedReadCode,
  parseResponse,
  QuoteFeedError,
} from "../quotes/contract/quote";

// Where a listing comes from: BYMA through IOL's panels, the US exchanges
// (NYSE, Nasdaq, NYSE Arca), or crypto named by CoinGecko and quoted by
// Kraken.
export const LISTING_MARKETS = ["byma", "us", "crypto"] as const;
export type ListingMarket = (typeof LISTING_MARKETS)[number];

// An instrument a provider lists, in the shape the catalog keeps it.
export type Listing = {
  symbol: string;
  name: string;
  type: InstrumentType;
  currency: Currency;
  market: ListingMarket;
  // The symbols of its dollar lines where the market lists them under a
  // name of their own (GOGLD for GOOGL), so a search for one finds it.
  lines?: readonly string[];
};

const NAME_MAX = 120;

const lineSchema = z.object({
  simbolo: z.string(),
  descripcion: z.string().optional().nullable(),
  moneda: z.unknown().optional(),
});

const nameOf = (text: string | null | undefined, symbol: string) => {
  const name = (text ?? "").replace(/\s+/g, " ").trim().slice(0, NAME_MAX);
  return name === "" ? symbol : name;
};

// A panel's peso lines as listings. A dollar line (the symbol with D or C)
// is the same instrument; a bond with a dollar MEP line is kept in dollars,
// as the feed then quotes that line.
export function panelListings(
  type: keyof typeof PANELS,
  titulos: readonly unknown[],
): Listing[] {
  const lines = titulos.flatMap((raw) => {
    const line = lineSchema.safeParse(raw);
    return line.success ? [line.data] : [];
  });
  const dollarLines = new Set(
    lines
      .filter(
        ({ moneda }) =>
          typeof moneda === "string" &&
          Object.hasOwn(MONEDA, moneda) &&
          MONEDA[moneda] === "USD",
      )
      .map(({ simbolo }) => simbolo),
  );
  const listings: Listing[] = [];
  const seen = new Set<string>();
  for (const { simbolo, descripcion, moneda } of lines) {
    const pesos =
      moneda === undefined ||
      moneda === null ||
      (typeof moneda === "string" &&
        Object.hasOwn(MONEDA, moneda) &&
        MONEDA[moneda] === "ARS");
    if (!pesos || !LOCAL_SYMBOL_PATTERN.test(simbolo) || seen.has(simbolo))
      continue;
    seen.add(simbolo);
    listings.push({
      symbol: simbolo,
      name: nameOf(descripcion, simbolo),
      type,
      currency:
        type === "bond" && dollarLines.has(`${simbolo}D`) ? "USD" : "ARS",
      market: "byma",
    });
  }
  // Each dollar line goes with its peso line: the same symbol without its D
  // or C (NUD, NU), else the same description, else the one peso symbol its
  // stem's letters spell in order (GOGLD, GOOGL), as IOL names some lines
  // after an older name ("Cedear Google Inc." for "Alphabet").
  const lined = new Map<string, string[]>();
  for (const { simbolo, descripcion, moneda } of lines) {
    if (
      typeof moneda !== "string" ||
      !Object.hasOwn(MONEDA, moneda) ||
      MONEDA[moneda] !== "USD" ||
      !LOCAL_SYMBOL_PATTERN.test(simbolo) ||
      !/[DC]$/.test(simbolo)
    ) {
      continue;
    }
    const stem = simbolo.slice(0, -1);
    const name = nameOf(descripcion, "");
    const spelled = listings.filter(
      ({ symbol }) =>
        symbol[0] === stem[0] &&
        symbol.length - stem.length <= 2 &&
        spells(symbol, stem),
    );
    const peso =
      listings.find(({ symbol }) => symbol === stem) ??
      (name === "" ? undefined : listings.find((each) => each.name === name)) ??
      (spelled.length === 1 ? spelled[0] : undefined);
    if (!peso || peso.symbol === simbolo) continue;
    lined.set(peso.symbol, [...(lined.get(peso.symbol) ?? []), simbolo]);
  }
  for (const listing of listings) {
    const found = lined.get(listing.symbol);
    if (found) listing.lines = found;
  }
  return listings;
}

// Whether `stem`'s letters appear in `symbol` in order.
function spells(symbol: string, stem: string): boolean {
  let at = 0;
  for (const letter of symbol) if (letter === stem[at]) at += 1;
  return at === stem.length;
}

const coinGeckoSchema = z.object({
  coins: z.array(
    z.object({
      name: z.string(),
      symbol: z.string(),
      market_cap_rank: z.number().nullable().optional(),
    }),
  ),
});

// CoinGecko's search answer as crypto listings in dollars, by market cap
// rank, one per symbol.
export function coinGeckoListings(json: unknown): Listing[] {
  const { coins } = parseResponse(coinGeckoSchema, json);
  const ranked = [...coins].sort(
    (a, b) =>
      (a.market_cap_rank ?? Number.MAX_SAFE_INTEGER) -
      (b.market_cap_rank ?? Number.MAX_SAFE_INTEGER),
  );
  const seen = new Set<string>();
  const listings: Listing[] = [];
  for (const coin of ranked) {
    const symbol = coin.symbol.toUpperCase();
    if (!LOCAL_SYMBOL_PATTERN.test(symbol) || seen.has(symbol)) continue;
    seen.add(symbol);
    listings.push({
      symbol,
      name: nameOf(coin.name, symbol),
      type: "crypto",
      currency: "USD",
      market: "crypto",
    });
  }
  return listings;
}

const DOLLAR_LINE_TYPES: readonly InstrumentType[] = ["cedear", "bond"];

// Whether a listing is exactly what the text names: its own symbol, or one of
// its dollar lines (GOGLD is GOOGL's MEP line, AL30D AL30's), with the line.
export function exactMatch(
  listing: Listing,
  text: string,
): { line: DollarLine | null } | null {
  if (symbolKey(listing.symbol) === symbolKey(text)) return { line: null };
  if (usTicker(text) !== null) return null;
  const wanted = normalizeSymbol(text);
  const line = dollarLineOf(wanted);
  if (line === null) return null;
  if (listing.lines?.some((each) => normalizeSymbol(each) === wanted)) {
    return { line };
  }
  return DOLLAR_LINE_TYPES.includes(listing.type) &&
    normalizeSymbol(listing.symbol) === wanted.slice(0, -1)
    ? { line }
    : null;
}

// The market's listing for exactly what an import called an instrument.
export function exactListing(
  listings: readonly Listing[],
  called: string,
): { listing: Listing; line: DollarLine | null } | null {
  for (const listing of listings) {
    const match = exactMatch(listing, called);
    if (match) return { listing, ...match };
  }
  return null;
}

// The listings whose symbol or name holds the query: an exact match first
// (or the US listing of a bare ticker: VOO finds VOO.US), then symbols that
// start with it, then the rest, each in the providers' order.
export function matchListings(
  listings: readonly Listing[],
  query: string,
  limit: number,
): Listing[] {
  const wanted = normalizeSymbol(query);
  if (wanted === "") return [];
  const rank = (listing: Listing) => {
    if (exactMatch(listing, query)) return 0;
    if (normalizeSymbol(usTicker(listing.symbol) ?? "") === wanted) return 0;
    const key = normalizeSymbol(listing.symbol);
    const name = normalizeSymbol(listing.name);
    if (key.startsWith(wanted)) return 1;
    if (name.startsWith(wanted)) return 2;
    return key.includes(wanted) || name.includes(wanted) ? 3 : null;
  };
  return listings
    .flatMap((listing) => {
      const at = rank(listing);
      return at === null ? [] : [{ listing, at }];
    })
    .sort((a, b) => a.at - b.at)
    .slice(0, limit)
    .map(({ listing }) => listing);
}

const COINGECKO_SEARCH = "https://api.coingecko.com/api/v3/search?query=";
const ASSET_PAIRS_URL = "https://api.kraken.com/0/public/AssetPairs";
const CACHE_TTL_MS = 6 * 60 * 60_000;

// Kraken's own asset names, as the catalog names them.
const CATALOG_ASSET: Readonly<Record<string, string>> = {
  XBT: "BTC",
  XDG: "DOGE",
};

const assetPairsSchema = z.object({
  error: z.array(z.string()),
  result: z.record(z.string(), z.object({ wsname: z.string().optional() })),
});

// The assets Kraken trades against the dollar, by their catalog symbol, from
// each pair's "BASE/USD" name.
export function krakenUsdAssets(json: unknown): ReadonlySet<string> {
  const { error, result } = parseResponse(assetPairsSchema, json);
  if (error.some((entry) => entry.startsWith("E"))) {
    throw new QuoteFeedError("provider_error");
  }
  const assets = new Set<string>();
  for (const { wsname } of Object.values(result)) {
    const [base, quote] = (wsname ?? "").split("/");
    if (!base || quote !== "USD") continue;
    assets.add(
      Object.hasOwn(CATALOG_ASSET, base) ? CATALOG_ASSET[base]! : base,
    );
  }
  return assets;
}

// What a market's provider lists for a query.
export type MarketReader = (query: string) => Promise<Listing[]>;

// us: the US listings' reader, which the catalog factory wires.
export type CatalogSearchDeps = {
  getJson: GetJson;
  postForm: PostForm;
  iol: IolCredentials | null;
  us: MarketReader;
  now?: () => number;
};

// A market whose provider did not answer, with the feed code it failed with
// (_OTHER for an error that carries none).
export type MarketFailure = { market: ListingMarket; code: string };

// What a search found, and the markets whose provider did not answer.
export type SearchFound = { listings: Listing[]; failed: MarketFailure[] };

export type CatalogSearch = {
  // What the providers of the given markets list for the query.
  search(
    query: string,
    limit: number,
    markets?: readonly ListingMarket[],
  ): Promise<SearchFound>;
  // The provider's own listing for a symbol, checked again: a BYMA line IOL
  // lists, a US listing the US reader finds, or a crypto CoinGecko names
  // that Kraken quotes in dollars.
  verify(symbol: string, market: ListingMarket): Promise<Listing | null>;
};

// The BYMA panels and Kraken's dollar pairs are read whole and kept a few
// hours per instance; the crypto search asks CoinGecko each time and keeps
// only the coins Kraken quotes in dollars, so the quotes job can price them.
export function createCatalogSearch(deps: CatalogSearchDeps): CatalogSearch {
  const now = deps.now ?? Date.now;
  const login = createIolSession(deps);

  async function readByma(): Promise<Listing[]> {
    if (!deps.iol) throw new QuoteFeedError("unconfigured");
    const { access } = await login.token(now(), deps.iol);
    const types = Object.keys(PANELS) as (keyof typeof PANELS)[];
    const read = await Promise.all(
      types.flatMap((type) =>
        PANELS[type].map(async (panel) => {
          const lines = await readPanel(deps.getJson, access, panel);
          if (!lines.ok) throw new QuoteFeedError(lines.code);
          return panelListings(type, lines.titulos);
        }),
      ),
    );
    const seen = new Set<string>();
    return read.flat().filter(({ symbol }) => {
      if (seen.has(symbol)) return false;
      seen.add(symbol);
      return true;
    });
  }

  const bymaListings = expiring(readByma, CACHE_TTL_MS, now);
  const krakenAssets = expiring(
    async () => krakenUsdAssets(await deps.getJson(ASSET_PAIRS_URL)),
    CACHE_TTL_MS,
    now,
  );

  async function crypto(query: string): Promise<Listing[]> {
    const [json, assets] = await Promise.all([
      deps.getJson(`${COINGECKO_SEARCH}${encodeURIComponent(query)}`),
      krakenAssets(),
    ]);
    return coinGeckoListings(json).filter(({ symbol }) => assets.has(symbol));
  }

  const readers: Record<ListingMarket, MarketReader> = {
    byma: () => bymaListings(),
    // Yahoo writes a US ticker bare: VOO.US is asked as VOO.
    us: (query) => deps.us(usTicker(query) ?? query),
    crypto,
  };

  // The symbols each market's listings take.
  const symbolOf: Record<ListingMarket, (symbol: string) => boolean> = {
    byma: (symbol) => LOCAL_SYMBOL_PATTERN.test(symbol),
    us: (symbol) => usTicker(symbol) !== null && !/[a-z]/.test(symbol),
    crypto: (symbol) => LOCAL_SYMBOL_PATTERN.test(symbol),
  };

  return {
    async search(query, limit, markets = LISTING_MARKETS) {
      const text = query.trim();
      if (normalizeSymbol(text) === "") return { listings: [], failed: [] };
      const asked = [...new Set(markets)];
      const read = await Promise.allSettled(
        asked.map((market) => readers[market](text)),
      );
      const failed = asked.flatMap((market, i) => {
        const each = read[i]!;
        return each.status === "rejected"
          ? [{ market, code: feedReadCode(each.reason) ?? "_OTHER" }]
          : [];
      });
      if (failed.length === asked.length && asked.length > 0) {
        throw (read[0] as PromiseRejectedResult).reason;
      }
      const listed = read.flatMap((each) =>
        each.status === "fulfilled" ? each.value : [],
      );
      return { listings: matchListings(listed, text, limit), failed };
    },

    async verify(symbol, market) {
      if (!symbolOf[market](symbol)) return null;
      const listings = await readers[market](usTicker(symbol) ?? symbol);
      return listings.find((listing) => listing.symbol === symbol) ?? null;
    },
  };
}
