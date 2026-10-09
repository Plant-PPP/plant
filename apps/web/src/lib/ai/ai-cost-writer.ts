import "server-only";
import type { AiCostInsert, Database } from "@plant/shared";
import type { SupabaseClient } from "@supabase/supabase-js";

import { postgrestInsert } from "@/lib/supabase/postgrest-write";

const TIMEOUT_MS = 1500;

// `code` is `missing_key` or a PostgrestFailure code; `mayHaveCommitted` as
// in PostgrestFailure.
export class AiCostWriteError extends Error {
  override name = "AiCostWriteError";

  constructor(
    readonly code: string,
    readonly mayHaveCommitted = false,
  ) {
    super(code);
  }
}

export function createAiCostWriter(
  client: SupabaseClient<Database>,
): (row: AiCostInsert) => Promise<void> {
  return async (row) => {
    const result = await postgrestInsert(
      (signal) =>
        client
          .from("ai_costs")
          // See AiCostInsert: the amount stays a decimal string.
          .insert({ ...row, amount_usd: row.amount_usd as unknown as number })
          .abortSignal(signal),
      TIMEOUT_MS,
    );
    if ("code" in result) {
      throw new AiCostWriteError(result.code, result.mayHaveCommitted);
    }
  };
}
