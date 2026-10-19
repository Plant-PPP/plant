import { buenosAiresDate, chunked } from "@plant/shared";
import { z } from "zod";

import type { GetJson, RawQuoteFeed } from "../../contract/port";
import {
  feedReadCode,
  parseResponse,
  type PartsRead,
  type RawPrice,
  readParts,
} from "../../contract/quote";
import { YAHOO_BASE_URL, YAHOO_HEADERS, yahooTicker } from "./http";

// Yahoo answers at most 20 tickers per request.
const CHUNK = 20;

export const sparkUrl = (tickers: readonly string[]) =>
  `${YAHOO_BASE_URL}/v7/finance/spark?symbols=${tickers
    .map(encodeURIComponent)
    .join(",")}&range=1d&interval=1d`;

// A ticker Yahoo does not know is left out of the answer; a request naming
// only unknown tickers is answered 404.
const sparkSchema = z.object({
  spark: z.object({
    result: z
      .array(
        z.object({
          symbol: z.string(),
          response: z.array(
            z.object({
              meta: z.object({
                currency: z.string().nullable().optional(),
                regularMarketPrice: z.number().optional(),
                regularMarketTime: z.number().optional(),
              }),
            }),
          ),
        }),
      )
      .nullable(),
  }),
});

const DECIMAL = /^\d+(\.\d+)?$/;

// An answer that knows none of the tickers asked.
const UNKNOWN = { spark: { result: null } };

// Each symbol's row from a spark answer: its last regular-session price in
// dollars, dated when it traded. A symbol missing from the answer, or not in
// dollars, gets a price the schemas refuse.
export function parseSpark(
  json: unknown,
  symbols: readonly string[],
  now: Date,
): RawPrice[] {
  const { result } = parseResponse(sparkSchema, json).spark;
  const byTicker = new Map(
    (result ?? []).map(({ symbol, response }) => [symbol, response[0]?.meta]),
  );
  return symbols.map((symbol) => {
    const meta = byTicker.get(yahooTicker(symbol) ?? "");
    const refused: RawPrice = {
      symbol,
      price_date: buenosAiresDate(now),
      price: "",
      currency: "USD",
      quoted_at: now.toISOString(),
    };
    const { regularMarketPrice: price, regularMarketTime: time } = meta ?? {};
    if (
      meta?.currency !== "USD" ||
      price === undefined ||
      time === undefined ||
      !(price > 0) ||
      !DECIMAL.test(String(price))
    ) {
      return refused;
    }
    const at = new Date(time * 1000);
    if (Number.isNaN(at.getTime())) return refused;
    return {
      ...refused,
      price: String(price),
      price_date: buenosAiresDate(at),
      quoted_at: at.toISOString(),
    };
  });
}

// symbols are the catalog's US listings, which the server adds only once
// Yahoo lists them.
export function createYahooFeed(
  getJson: GetJson,
  symbols: () => Promise<readonly string[]>,
): RawQuoteFeed {
  const read = async (part: readonly string[], now: Date) =>
    parseSpark(
      await getJson(
        sparkUrl(part.map((symbol) => yahooTicker(symbol) ?? symbol)),
        { headers: YAHOO_HEADERS },
      ),
      part,
      now,
    );

  // A 404 says no ticker of the part is known, or one is gone: each is then
  // asked alone, and one Yahoo still does not know gets a refused price.
  const readPart = async (
    part: readonly string[],
    now: Date,
  ): Promise<PartsRead> => {
    try {
      return { prices: await read(part, now), unread: [] };
    } catch (error) {
      if (feedReadCode(error) !== "http_404") throw error;
      if (part.length === 1) {
        return { prices: parseSpark(UNKNOWN, part, now), unread: [] };
      }
      return readParts(
        part.map((symbol) => [symbol]),
        (single) => single,
        (single) => readPart(single, now),
      );
    }
  };

  return {
    id: "yahoo",
    listed: true,
    async readRaw(now) {
      const wanted = [...new Set(await symbols())].sort();
      if (wanted.length === 0) return { fxRates: [], prices: [], idle: true };
      const { prices, unread } = await readParts(
        chunked(wanted, CHUNK),
        (part) => part,
        (part) => readPart(part, now),
      );
      return { fxRates: [], prices, unread };
    },
  };
}
