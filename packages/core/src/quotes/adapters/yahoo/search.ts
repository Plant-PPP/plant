import { usListingSymbol } from "@plant/shared";
import { z } from "zod";

import type { GetJson } from "../../contract/port";
import { parseResponse } from "../../contract/quote";
import { US_EXCHANGES, YAHOO_BASE_URL, YAHOO_HEADERS } from "./http";

const NAME_MAX = 120;

const searchSchema = z.object({
  quotes: z.array(
    z.object({
      symbol: z.string(),
      quoteType: z.string().optional(),
      exchange: z.string().optional(),
      longname: z.string().nullable().optional(),
      shortname: z.string().nullable().optional(),
    }),
  ),
});

const TYPES = { EQUITY: "stock", ETF: "etf" } as const;

// A stock or ETF listed on a US exchange, by its catalog symbol.
export type UsListing = {
  symbol: string;
  name: string;
  type: (typeof TYPES)[keyof typeof TYPES];
};

export const searchUrl = (query: string) =>
  `${YAHOO_BASE_URL}/v1/finance/search?q=${encodeURIComponent(query)}` +
  "&quotesCount=20&newsCount=0&listsCount=0";

// Yahoo's search answer as US listings, in its order, one per symbol: a
// listing on another exchange (VOO.MX), an option or a fund is left out.
export function yahooListings(json: unknown): UsListing[] {
  const { quotes } = parseResponse(searchSchema, json);
  const seen = new Set<string>();
  const listings: UsListing[] = [];
  for (const quote of quotes) {
    const type =
      quote.quoteType !== undefined && Object.hasOwn(TYPES, quote.quoteType)
        ? TYPES[quote.quoteType as keyof typeof TYPES]
        : null;
    const symbol = usListingSymbol(quote.symbol);
    if (
      type === null ||
      !US_EXCHANGES.has(quote.exchange ?? "") ||
      symbol === null ||
      seen.has(symbol)
    ) {
      continue;
    }
    seen.add(symbol);
    const name = (quote.longname ?? quote.shortname ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, NAME_MAX);
    listings.push({ symbol, name: name === "" ? symbol : name, type });
  }
  return listings;
}

export async function searchYahoo(
  getJson: GetJson,
  query: string,
): Promise<UsListing[]> {
  return yahooListings(
    await getJson(searchUrl(query), { headers: YAHOO_HEADERS }),
  );
}
