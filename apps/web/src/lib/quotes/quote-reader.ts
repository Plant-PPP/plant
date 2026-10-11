import "server-only";
import type { QuoteRange, QuoteReaderPort } from "@plant/core";
import { type Database, daysBetween } from "@plant/shared";
import type {
  PostgrestSingleResponse,
  SupabaseClient,
} from "@supabase/supabase-js";

import { STORE_TIMEOUT_MS, storeError } from "@/lib/quotes/store-error";
import { postgrestCall } from "@/lib/supabase/postgrest-write";

// PostgREST's cap on the rows of one response, [api] max_rows in
// supabase/config.toml (a test pins it). Past it the rows are cut silently.
export const MAX_ROWS = 1000;

// A read that came back with fewer rows than the store counted (max_rows is
// lower than this reader assumes), or with no count to check against. A bug,
// not a store failure.
export class QuoteReadTruncated extends Error {
  override readonly name = "QuoteReadTruncated";
  constructor(reason: "cut" | "uncounted") {
    super(`quote read ${reason}`);
  }
}

const EXACT = { count: "exact" } as const;

type Countable<T> = {
  limit(rows: number): {
    abortSignal(signal: AbortSignal): PromiseLike<PostgrestSingleResponse<T[]>>;
  };
};

// At most `rows` rows, counted by the store: one row per key and day, so a
// count above the rows returned means PostgREST cut the answer. PostgREST
// answers a counted read it cut with 206.
async function capped<T>(
  rows: number,
  query: (count: typeof EXACT) => Countable<T>,
): Promise<T[]> {
  const result = await postgrestCall(
    (signal) => query(EXACT).limit(rows).abortSignal(signal),
    STORE_TIMEOUT_MS,
    [200, 206],
  );
  if ("code" in result) throw storeError(result);
  const data = result.data ?? [];
  if (result.count === null) throw new QuoteReadTruncated("uncounted");
  if (result.count > data.length) throw new QuoteReadTruncated("cut");
  return data;
}

function chunked<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let start = 0; start < items.length; start += size) {
    chunks.push(items.slice(start, start + size));
  }
  return chunks;
}

// Reads with the caller's client, so RLS and the MFA gate apply. Amounts are
// selected as text.
export function createQuoteReader(
  client: SupabaseClient<Database>,
): QuoteReaderPort {
  return {
    async read({ fxKinds, symbols, from, to }: QuoteRange) {
      const days = daysBetween(from, to) + 1;
      // fx is one call over every kind; a price chunk holds as many symbols
      // as fit in MAX_ROWS.
      if (days < 1 || Math.max(fxKinds.length, 1) * days > MAX_ROWS) {
        throw new RangeError("Quote range out of bounds");
      }
      const fxRates =
        fxKinds.length === 0
          ? Promise.resolve([])
          : capped(fxKinds.length * days, (count) =>
              client
                .from("fx_rates")
                .select("kind, rate_date, sell:sell::text", count)
                .in("kind", [...fxKinds])
                .gte("rate_date", from)
                .lte("rate_date", to),
            );
      const prices = chunked(symbols, Math.floor(MAX_ROWS / days)).map(
        (chunk) =>
          capped(chunk.length * days, (count) =>
            client
              .from("prices")
              .select("symbol, price_date, price:price::text, currency", count)
              .in("symbol", chunk)
              .gte("price_date", from)
              .lte("price_date", to),
          ),
      );
      const [fxRows, priceRows] = await Promise.all([
        fxRates,
        Promise.all(prices),
      ]);
      return { fxRates: fxRows, prices: priceRows.flat() };
    },
  };
}
