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
import { krakenPair, tickerUrl } from "../quotes/adapters/kraken/feed";
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

// The listings whose symbol or name holds the query, an exact symbol first,
// then symbols that start with it, then the rest, each in the providers'
// order.
export function matchListings(
  listings: readonly Listing[],
  query: string,
  limit: number,
): Listing[] {
  const wanted = normalizeSymbol(query);
  if (wanted === "") return [];
  const rank = ({ symbol, name }: Listing) => {
    const key = normalizeSymbol(symbol);
    if (key === wanted) return 0;
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
const PANEL_TTL_MS = 6 * 60 * 60_000;

export type CatalogSearchDeps = {
  getJson: GetJson;
  postForm: PostForm;
  iol: IolCredentials | null;
  now?: () => number;
};

export type CatalogSearch = {
  // What the providers list for the query; a provider that fails is left out.
  search(query: string, limit: number): Promise<Listing[]>;
  // The provider's own listing for a symbol, checked again: a BYMA line IOL
  // lists, or a crypto CoinGecko names that Kraken quotes in dollars.
  verify(symbol: string, market: ListingMarket): Promise<Listing | null>;
};

// The BYMA panels are read whole and kept a few hours per instance; the
// crypto search asks CoinGecko each time.
export function createCatalogSearch(deps: CatalogSearchDeps): CatalogSearch {
  const now = deps.now ?? Date.now;
  const login = createIolSession(deps);
  let byma: { at: number; listings: Promise<Listing[]> } | null = null;

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

  function bymaListings(): Promise<Listing[]> {
    const at = now();
    if (!byma || at - byma.at >= PANEL_TTL_MS) {
      const listings = readByma();
      byma = { at, listings };
      // A failed read is asked again on the next search.
      listings.catch(() => {
        if (byma?.listings === listings) byma = null;
      });
    }
    return byma.listings;
  }

  async function crypto(query: string): Promise<Listing[]> {
    const json = await deps.getJson(
      `${COINGECKO_SEARCH}${encodeURIComponent(query)}`,
    );
    return coinGeckoListings(json);
  }

  async function quotedByKraken(symbol: string): Promise<boolean> {
    const json = await deps.getJson(tickerUrl([symbol]));
    const answer = z
      .object({
        error: z.array(z.string()),
        result: z.record(z.string(), z.unknown()).optional(),
      })
      .safeParse(json);
    if (!answer.success || answer.data.error.length > 0) return false;
    const result = answer.data.result ?? {};
    return krakenPair(symbol).resultKeys.some((key) =>
      Object.hasOwn(result, key),
    );
  }

  return {
    async search(query, limit) {
      const text = query.trim();
      if (normalizeSymbol(text) === "") return [];
      const [fromByma, fromCrypto] = await Promise.allSettled([
        bymaListings(),
        crypto(text),
      ]);
      const listed = [
        ...(fromByma.status === "fulfilled" ? fromByma.value : []),
        ...(fromCrypto.status === "fulfilled" ? fromCrypto.value : []),
      ];
      if (fromByma.status === "rejected" && fromCrypto.status === "rejected") {
        throw fromByma.reason;
      }
      return matchListings(listed, text, limit);
    },

    async verify(symbol, market) {
      if (!SYMBOL_FORMAT.test(symbol)) return null;
      if (market === "byma") {
        const listings = await bymaListings();
        return listings.find((listing) => listing.symbol === symbol) ?? null;
      }
      const named = (await crypto(symbol)).find(
        (listing) => listing.symbol === symbol,
      );
      if (!named) return null;
      return (await quotedByKraken(symbol)) ? named : null;
    },
  };
}
