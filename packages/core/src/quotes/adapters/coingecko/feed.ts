import { buenosAiresDate } from "@plant/shared";
import { z } from "zod";

import type { GetJson, RawQuoteFeed } from "../../contract/port";
import { parseResponse, type RawPrice } from "../../contract/quote";

const PRICE_URL = "https://api.coingecko.com/api/v3/simple/price";

// CoinGecko's id of each crypto it quotes for Plant. A symbol without one is
// left to Kraken.
export const COINGECKO_IDS: Readonly<Record<string, string>> = {
  AAVE: "aave",
  ADA: "cardano",
  APT: "aptos",
  ARB: "arbitrum",
  ATOM: "cosmos",
  AVAX: "avalanche-2",
  BCH: "bitcoin-cash",
  BNB: "binancecoin",
  BTC: "bitcoin",
  DOGE: "dogecoin",
  DOT: "polkadot",
  ETC: "ethereum-classic",
  ETH: "ethereum",
  FIL: "filecoin",
  INJ: "injective-protocol",
  LDO: "lido-dao",
  LINK: "chainlink",
  LTC: "litecoin",
  MKR: "maker",
  NEAR: "near",
  NEXO: "nexo",
  OP: "optimism",
  PEPE: "pepe",
  POL: "polygon-ecosystem-token",
  RENDER: "render-token",
  SHIB: "shiba-inu",
  SOL: "solana",
  SUI: "sui",
  TON: "the-open-network",
  TRX: "tron",
  UNI: "uniswap",
  USDC: "usd-coin",
  USDT: "tether",
  WBTC: "wrapped-bitcoin",
  XLM: "stellar",
  XRP: "ripple",
};

export const priceUrl = (ids: readonly string[]) =>
  `${PRICE_URL}?ids=${ids.map(encodeURIComponent).join(",")}&vs_currencies=usd&include_last_updated_at=true`;

// An id CoinGecko does not know is left out of the answer.
const responseSchema = z.record(
  z.string(),
  z.object({
    usd: z.number().optional(),
    last_updated_at: z.number().optional(),
  }),
);

// Each symbol's price in dollars, dated when CoinGecko last updated it. A
// symbol missing from the answer gets a price the schemas refuse.
export function parse(
  json: unknown,
  now: Date,
  symbols: readonly string[],
): RawPrice[] {
  const result = parseResponse(responseSchema, json);
  return symbols.map((symbol) => {
    const quote = result[COINGECKO_IDS[symbol] ?? ""];
    const refused: RawPrice = {
      symbol,
      price_date: buenosAiresDate(now),
      price: "",
      currency: "USD",
      quoted_at: now.toISOString(),
    };
    if (
      quote?.usd === undefined ||
      !(quote.usd > 0) ||
      quote.last_updated_at === undefined
    ) {
      return refused;
    }
    const at = new Date(quote.last_updated_at * 1000);
    if (Number.isNaN(at.getTime())) return refused;
    return {
      ...refused,
      // CoinGecko answers a float: a tiny price may come in exponent form.
      price: quote.usd.toFixed(8).replace(/\.?0+$/, ""),
      price_date: buenosAiresDate(at),
      quoted_at: at.toISOString(),
    };
  });
}

// symbols are the catalog's crypto; it quotes the ones it has an id for.
// Kraken runs first, so a price it saved for the day stays.
export function createCoingeckoFeed(
  getJson: GetJson,
  symbols: () => Promise<readonly string[]>,
): RawQuoteFeed {
  return {
    id: "coingecko",
    listed: false,
    async readRaw(now) {
      const wanted = [...new Set(await symbols())]
        .filter((symbol) => Object.hasOwn(COINGECKO_IDS, symbol))
        .sort();
      if (wanted.length === 0) return { fxRates: [], prices: [], idle: true };
      const json = await getJson(
        priceUrl(wanted.map((symbol) => COINGECKO_IDS[symbol]!)),
      );
      return { fxRates: [], prices: parse(json, now, wanted) };
    },
  };
}
