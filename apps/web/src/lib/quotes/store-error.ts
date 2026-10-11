import "server-only";
import { type QuoteStoreCode, QuoteStoreError } from "@plant/core";

import {
  ERROR_CODE,
  type PostgrestFailure,
} from "@/lib/supabase/postgrest-write";

export const STORE_TIMEOUT_MS = 10_000;
// The quotes migration's insert guard raises it for any date but today.
export const GUARD_SQLSTATE = "PT403";

const CODE_BY_SQLSTATE: Readonly<Record<string, QuoteStoreCode>> = {
  [GUARD_SQLSTATE]: "out_of_window",
  "42501": "forbidden",
  "23514": "invalid_row",
  "23502": "invalid_row",
  "22003": "invalid_row",
  "22P02": "invalid_row",
};

export function storeError({ code, mayHaveCommitted }: PostgrestFailure) {
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
