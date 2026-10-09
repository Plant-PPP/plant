import { buenosAiresDate } from "@plant/shared";
import { z } from "zod";

import type { GetJson, RawQuoteFeed } from "../../contract/port";
import {
  parseResponse,
  QuoteFeedError,
  type RawQuoteRows,
} from "../../contract/quote";

// pair is what the request names; resultKey is how the answer names it.
const PAIRS: readonly { symbol: string; pair: string; resultKey: string }[] = [
  { symbol: "BTC", pair: "XBTUSD", resultKey: "XXBTZUSD" },
  { symbol: "ETH", pair: "ETHUSD", resultKey: "XETHZUSD" },
  { symbol: "SOL", pair: "SOLUSD", resultKey: "SOLUSD" },
  { symbol: "USDT", pair: "USDTUSD", resultKey: "USDTZUSD" },
  { symbol: "USDC", pair: "USDCUSD", resultKey: "USDCUSD" },
];

const URL = `https://api.kraken.com/0/public/Ticker?pair=${PAIRS.map((p) => p.pair).join(",")}`;

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
const TRANSIENT_ERROR = /^E(Service:|API:Rate limit|General:Temporary)/;

export function parse(json: unknown, now: Date): RawQuoteRows {
  const response = parseResponse(responseSchema, json);
  const errors = response.error.filter((entry) => !entry.startsWith("W"));
  if (errors.length > 0) {
    throw new QuoteFeedError(
      "provider_error",
      errors.every((entry) => TRANSIENT_ERROR.test(entry)),
    );
  }
  const result = response.result ?? {};
  const instant = now.toISOString();
  const today = buenosAiresDate(now);
  return {
    fxRates: [],
    // A pair missing from the answer gets an empty price, which the schemas
    // count as invalid.
    prices: PAIRS.map(({ symbol, resultKey }) => ({
      symbol,
      price_date: today,
      price: result[resultKey]?.c[0] ?? "",
      currency: "USD",
      source: "kraken",
      quoted_at: instant,
    })),
  };
}

export function createKrakenFeed(getJson: GetJson): RawQuoteFeed {
  return {
    id: "kraken",
    async readRaw(now) {
      return parse(await getJson(URL), now);
    },
  };
}
