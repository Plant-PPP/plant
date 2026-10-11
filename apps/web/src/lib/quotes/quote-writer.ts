import "server-only";
import { QUOTE_KEYS, type QuoteRows, type QuoteStorePort } from "@plant/core";
import type { Database } from "@plant/shared";
import type {
  PostgrestSingleResponse,
  SupabaseClient,
} from "@supabase/supabase-js";

import { STORE_TIMEOUT_MS, storeError } from "@/lib/quotes/store-error";
import type { DecimalInsert } from "@/lib/supabase/decimal-columns";
import { postgrestInsert } from "@/lib/supabase/postgrest-write";

type Tables = Database["public"]["Tables"];

type FxRateInsert = DecimalInsert<Tables["fx_rates"]["Insert"], "buy" | "sell">;
type PriceInsert = DecimalInsert<Tables["prices"]["Insert"], "price">;

// A, or never when A and B do not have exactly the same keys: core's row and
// the insert must not drift apart in either direction.
type SameKeys<A, B> = [keyof A] extends [keyof B]
  ? [keyof B] extends [keyof A]
    ? A
    : never
  : never;

// A row already stored for its key is skipped and counts 0.
const ignoreStored = (table: keyof typeof QUOTE_KEYS) => ({
  onConflict: QUOTE_KEYS[table].join(","),
  ignoreDuplicates: true,
});

async function insert<T>(
  rows: readonly unknown[],
  query: (signal: AbortSignal) => PromiseLike<PostgrestSingleResponse<T[]>>,
): Promise<number> {
  if (rows.length === 0) return 0;
  const result = await postgrestInsert(query, STORE_TIMEOUT_MS);
  if ("code" in result) throw storeError(result);
  return (result.data ?? []).length;
}

// Inserts each table's rows once. The amounts stay decimal strings, cast at
// the call as in ai-cost-writer.ts.
export function createQuoteWriter(
  client: SupabaseClient<Database>,
): QuoteStorePort {
  return {
    async save(rows: QuoteRows) {
      const fxRates: FxRateInsert[] = rows.fxRates satisfies SameKeys<
        (typeof rows.fxRates)[number],
        FxRateInsert
      >[];
      const prices: PriceInsert[] = rows.prices satisfies SameKeys<
        (typeof rows.prices)[number],
        PriceInsert
      >[];
      return {
        fxRates: await insert(fxRates, (signal) =>
          client
            .from("fx_rates")
            .upsert(
              fxRates as unknown as Tables["fx_rates"]["Insert"][],
              ignoreStored("fxRates"),
            )
            .select(QUOTE_KEYS.fxRates[0])
            .abortSignal(signal),
        ),
        prices: await insert(prices, (signal) =>
          client
            .from("prices")
            .upsert(
              prices as unknown as Tables["prices"]["Insert"][],
              ignoreStored("prices"),
            )
            .select(QUOTE_KEYS.prices[0])
            .abortSignal(signal),
        ),
      };
    },
  };
}
