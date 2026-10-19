import "server-only";
import type {
  FxRateKind,
  QuoteRange,
  QuoteReaderPort,
  StoredQuotes,
} from "@plant/core";
import {
  chunked,
  type Currency,
  type Database,
  daysBetween,
} from "@plant/shared";
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

// quotes_before's rows: a dollar rate has a kind, a price a symbol and its
// currency. The generated types call every column non-null.
type QuoteBefore = {
  kind: FxRateKind | null;
  symbol: string | null;
  quote_date: string;
  amount: string;
  currency: Currency | null;
};

// Each key's latest quote before `before`, at most one row per key, so a call
// stays within MAX_ROWS by the keys it names.
async function quotesBefore(
  client: SupabaseClient<Database>,
  before: string,
  { fxKinds, symbols }: Pick<QuoteRange, "fxKinds" | "symbols">,
): Promise<StoredQuotes> {
  const calls =
    symbols.length === 0
      ? [{ fxKinds, symbols }]
      : chunked(symbols, MAX_ROWS - fxKinds.length).map((chunk, index) => ({
          fxKinds: index === 0 ? fxKinds : [],
          symbols: chunk,
        }));
  const read = await Promise.all(
    calls.map(async (keys) => {
      const result = await postgrestCall(
        (signal) =>
          client
            .rpc("quotes_before", {
              p_before: before,
              p_fx_kinds: [...keys.fxKinds],
              p_symbols: [...keys.symbols],
            })
            .abortSignal(signal),
        STORE_TIMEOUT_MS,
        [200],
      );
      if ("code" in result) throw storeError(result);
      const rows: readonly QuoteBefore[] = result.data ?? [];
      return rows;
    }),
  );
  const fxRates: StoredQuotes["fxRates"] = [];
  const prices: StoredQuotes["prices"] = [];
  for (const row of read.flat()) {
    if (row.kind !== null) {
      fxRates.push({
        kind: row.kind,
        rate_date: row.quote_date,
        sell: row.amount,
      });
    } else if (row.symbol !== null && row.currency !== null) {
      prices.push({
        symbol: row.symbol,
        price_date: row.quote_date,
        price: row.amount,
        currency: row.currency,
      });
    }
  }
  return { fxRates, prices };
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
      const [fxRows, priceRows, before] = await Promise.all([
        fxRates,
        Promise.all(prices),
        quotesBefore(client, from, { fxKinds, symbols }),
      ]);
      return {
        fxRates: [...fxRows, ...before.fxRates],
        prices: [...priceRows.flat(), ...before.prices],
      };
    },
  };
}
