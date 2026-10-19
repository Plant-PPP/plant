import { buenosAiresDate } from "@plant/shared";
import { z } from "zod";

import type { GetJson, RawQuoteFeed } from "../../contract/port";
import {
  parseResponse,
  QuoteFeedError,
  type RawQuoteRows,
  readParts,
} from "../../contract/quote";

const TICKER_URL = "https://api.kraken.com/0/public/Ticker";

// Kraken's own name for an asset, where it is not the symbol.
const KRAKEN_ASSET: Readonly<Record<string, string>> = {
  BTC: "XBT",
  DOGE: "XDG",
};

// pair is what the request names; the answer names it either the same or,
// for Kraken's older assets, X<asset>ZUSD (XXBTZUSD) or <asset>ZUSD
// (USDTZUSD).
export function krakenPair(symbol: string) {
  const asset = Object.hasOwn(KRAKEN_ASSET, symbol)
    ? KRAKEN_ASSET[symbol]
    : symbol;
  const pair = `${asset}USD`;
  return {
    symbol,
    pair,
    resultKeys: [pair, `X${asset}ZUSD`, `${asset}ZUSD`],
  };
}

export const tickerUrl = (symbols: readonly string[]) =>
  `${TICKER_URL}?pair=${symbols.map((symbol) => krakenPair(symbol).pair).join(",")}`;

// c is the last trade: [price, lot volume], both decimal strings.
const responseSchema = z.object({
  error: z.array(z.string()),
  result: z
    .record(z.string(), z.object({ c: z.tuple([z.string(), z.string()]) }))
    .optional(),
});

// Each error entry starts with its severity: E for an error, W for a warning
// that comes with a usable result. Only these errors pass on a retry; an
// unknown pair or a bad argument fails the same way every time.
const TRANSIENT_ERROR =
  /^E(Service:|API:Rate limit|General:(Temporary|Internal error|Too many requests))/;

export function parse(
  json: unknown,
  now: Date,
  symbols: readonly string[],
): RawQuoteRows {
  const response = parseResponse(responseSchema, json);
  const errors = response.error.filter((entry) => !entry.startsWith("W"));
  if (errors.length > 0) {
    throw new QuoteFeedError(
      errors.every((entry) => TRANSIENT_ERROR.test(entry))
        ? "provider_busy"
        : "provider_error",
    );
  }
  const result = response.result ?? {};
  const instant = now.toISOString();
  const today = buenosAiresDate(now);
  return {
    fxRates: [],
    // A pair missing from the answer gets an empty price, which the schemas
    // count as invalid.
    prices: symbols.map(krakenPair).map(({ symbol, resultKeys }) => {
      const key = resultKeys.find((each) => Object.hasOwn(result, each));
      return {
        symbol,
        price_date: today,
        price: key === undefined ? "" : (result[key]?.c[0] ?? ""),
        currency: "USD",
        quoted_at: instant,
      };
    }),
  };
}

async function readEach(
  getJson: GetJson,
  wanted: readonly string[],
  now: Date,
): Promise<RawQuoteRows> {
  const { prices, unread } = await readParts(
    wanted,
    (symbol) => [symbol],
    async (symbol) => ({
      prices: parse(await getJson(tickerUrl([symbol])), now, [symbol]).prices,
      unread: [],
    }),
  );
  return { fxRates: [], prices, unread };
}

// symbols are the catalog's crypto, which the server adds only once Kraken
// quotes it in dollars.
export function createKrakenFeed(
  getJson: GetJson,
  symbols: () => Promise<readonly string[]>,
): RawQuoteFeed {
  return {
    id: "kraken",
    listed: false,
    async readRaw(now) {
      const wanted = [...new Set(await symbols())].sort();
      if (wanted.length === 0) return { fxRates: [], prices: [], idle: true };
      try {
        return parse(await getJson(tickerUrl(wanted)), now, wanted);
      } catch (error) {
        // One pair Kraken no longer knows refuses the whole request: each
        // pair is then asked alone, and the ones it refuses are unread.
        if (
          wanted.length === 1 ||
          !(error instanceof QuoteFeedError) ||
          error.code !== "provider_error"
        ) {
          throw error;
        }
        return readEach(getJson, wanted, now);
      }
    },
  };
}
