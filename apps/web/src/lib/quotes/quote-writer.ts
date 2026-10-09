import "server-only";
import {
  QUOTE_KEYS,
  type QuoteRows,
  type QuoteStoreCode,
  QuoteStoreError,
  type QuoteStorePort,
} from "@plant/core";
import type { Database } from "@plant/shared";
import type {
  PostgrestSingleResponse,
  SupabaseClient,
} from "@supabase/supabase-js";

import {
  ERROR_CODE,
  type PostgrestFailure,
  postgrestInsert,
} from "@/lib/supabase/postgrest-write";

const TIMEOUT_MS = 10_000;
// The quotes migration's insert guard raises it for any date but today.
export const GUARD_SQLSTATE = "PT403";

type Tables = Database["public"]["Tables"];

// An insert with every column required and each amount column in A as a
// decimal string, null kept where the column is nullable.
type DecimalInsert<I, A extends keyof I> = {
  [K in keyof I]-?: K extends A
    ? null extends I[K]
      ? string | null
      : string
    : Exclude<I[K], undefined>;
};
type FxRateInsert = DecimalInsert<Tables["fx_rates"]["Insert"], "buy" | "sell">;
type PriceInsert = DecimalInsert<Tables["prices"]["Insert"], "price">;

// A, or never when A and B do not have exactly the same keys: core's row and
// the insert must not drift apart in either direction.
type SameKeys<A, B> = [keyof A] extends [keyof B]
  ? [keyof B] extends [keyof A]
    ? A
    : never
  : never;

const CODE_BY_SQLSTATE: Readonly<Record<string, QuoteStoreCode>> = {
  [GUARD_SQLSTATE]: "out_of_window",
  "42501": "forbidden",
  "23514": "invalid_row",
  "23502": "invalid_row",
  "22003": "invalid_row",
  "22P02": "invalid_row",
};

function storeError({ code, mayHaveCommitted }: PostgrestFailure) {
  const quoteCode: QuoteStoreCode =
    code === "timeout"
      ? "timeout"
      : mayHaveCommitted
        ? "unavailable"
        : (CODE_BY_SQLSTATE[code] ?? "rejected");
  return new QuoteStoreError(
    quoteCode,
    ERROR_CODE.test(code) ? code : undefined,
  );
}

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
  const result = await postgrestInsert(query, TIMEOUT_MS);
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
