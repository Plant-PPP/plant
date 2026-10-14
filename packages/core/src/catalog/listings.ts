import type { Currency } from "@plant/shared";
import { z } from "zod";

import { type InstrumentType, normalizeSymbol } from "../instruments";
import {
  createIolSession,
  type IolCredentials,
  MONEDA,
  PANELS,
  readPanel,
} from "../quotes/adapters/iol/feed";
import type { GetJson, PostForm } from "../quotes/contract/port";
import { parseResponse, QuoteFeedError } from "../quotes/contract/quote";

// Where a listing comes from: BYMA through IOL's panels, or crypto named by
// CoinGecko and quoted by Kraken.
export const LISTING_MARKETS = ["byma", "crypto"] as const;
export type ListingMarket = (typeof LISTING_MARKETS)[number];

// An instrument a provider lists, in the shape the catalog keeps it.
export type Listing = {
  symbol: string;
  name: string;
  type: InstrumentType;
  currency: Currency;
  market: ListingMarket;
};

// The catalog's symbol check (instruments_symbol_format).
export const SYMBOL_FORMAT = /^[A-Z0-9]{1,15}$/;
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
    if (!pesos || !SYMBOL_FORMAT.test(simbolo) || seen.has(simbolo)) continue;
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
  return listings;
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
    if (!SYMBOL_FORMAT.test(symbol) || seen.has(symbol)) continue;
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

// The listings whose symbol or name holds the query, an exact symbol (or
// the CEDEAR or bond whose dollar line it names) first,
// then symbols that start with it, then the rest, each in the providers'
// order.
export function matchListings(
  listings: readonly Listing[],
  query: string,
  limit: number,
): Listing[] {
  const wanted = normalizeSymbol(query);
  if (wanted === "") return [];
  // GOOGLD and GOOGLC are GOOGL's dollar lines: the same CEDEAR or bond.
  const base = /[DC]$/.test(wanted) ? wanted.slice(0, -1) : null;
  const rank = ({ symbol, name, type }: Listing) => {
    const key = normalizeSymbol(symbol);
    if (key === wanted) return 0;
    if (key === base && (type === "cedear" || type === "bond")) return 0;
    if (key.startsWith(wanted)) return 1;
    if (normalizeSymbol(name).startsWith(wanted)) return 2;
    return key.includes(wanted) || normalizeSymbol(name).includes(wanted)
      ? 3
      : null;
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

export type CatalogSearchDeps = {
  getJson: GetJson;
  postForm: PostForm;
  iol: IolCredentials | null;
  now?: () => number;
};

// What a search found, and the markets whose provider did not answer.
export type SearchFound = { listings: Listing[]; failed: ListingMarket[] };

export type CatalogSearch = {
  // What the providers of the given markets list for the query.
  search(
    query: string,
    limit: number,
    markets?: readonly ListingMarket[],
  ): Promise<SearchFound>;
  // The provider's own listing for a symbol, checked again: a BYMA line IOL
  // lists, or a crypto CoinGecko names that Kraken quotes in dollars.
  verify(symbol: string, market: ListingMarket): Promise<Listing | null>;
};

// The BYMA panels and Kraken's dollar pairs are read whole and kept a few
// hours per instance; the crypto search asks CoinGecko each time and keeps
// only the coins Kraken quotes in dollars, so the quotes job can price them.
export function createCatalogSearch(deps: CatalogSearchDeps): CatalogSearch {
  const now = deps.now ?? Date.now;
  const login = createIolSession(deps);
  let byma: { at: number; listings: Promise<Listing[]> } | null = null;
  let kraken: { at: number; assets: Promise<ReadonlySet<string>> } | null =
    null;

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

  // A read kept a few hours; a failed one is asked again on the next call.
  function kept<T>(
    slot: { at: number; value: Promise<T> } | null,
    read: () => Promise<T>,
    keep: (next: { at: number; value: Promise<T> } | null) => void,
  ): Promise<T> {
    const at = now();
    if (slot && at - slot.at < CACHE_TTL_MS) return slot.value;
    const value = read();
    const next = { at, value };
    keep(next);
    value.catch(() => keep(null));
    return value;
  }

  const bymaListings = () =>
    kept(byma && { at: byma.at, value: byma.listings }, readByma, (next) => {
      byma = next && { at: next.at, listings: next.value };
    });

  const krakenAssets = () =>
    kept(
      kraken && { at: kraken.at, value: kraken.assets },
      async () => krakenUsdAssets(await deps.getJson(ASSET_PAIRS_URL)),
      (next) => {
        kraken = next && { at: next.at, assets: next.value };
      },
    );

  async function crypto(query: string): Promise<Listing[]> {
    const [json, assets] = await Promise.all([
      deps.getJson(`${COINGECKO_SEARCH}${encodeURIComponent(query)}`),
      krakenAssets(),
    ]);
    return coinGeckoListings(json).filter(({ symbol }) => assets.has(symbol));
  }

  const readers: Record<ListingMarket, (query: string) => Promise<Listing[]>> =
    { byma: () => bymaListings(), crypto };

  return {
    async search(query, limit, markets = LISTING_MARKETS) {
      const text = query.trim();
      if (normalizeSymbol(text) === "") return { listings: [], failed: [] };
      const asked = [...new Set(markets)];
      const read = await Promise.allSettled(
        asked.map((market) => readers[market](text)),
      );
      const failed = asked.filter((_, i) => read[i]!.status === "rejected");
      if (failed.length === asked.length && asked.length > 0) {
        throw (read[0] as PromiseRejectedResult).reason;
      }
      const listed = read.flatMap((each) =>
        each.status === "fulfilled" ? each.value : [],
      );
      return { listings: matchListings(listed, text, limit), failed };
    },

    async verify(symbol, market) {
      if (!SYMBOL_FORMAT.test(symbol)) return null;
      const listings =
        market === "byma" ? await bymaListings() : await crypto(symbol);
      return listings.find((listing) => listing.symbol === symbol) ?? null;
    },
  };
}
