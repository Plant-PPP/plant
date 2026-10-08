import "server-only";
import type { AiCostInsert, Database } from "@plant/shared";
import type { SupabaseClient } from "@supabase/supabase-js";

const TIMEOUT_MS = 1500;
const ERROR_CODE = /^(?:[0-9A-Z]{5}|PGRST\d+)$/;

// The message is one of `timeout`, `fetch_error`, `missing_key`, a SQLSTATE
// or PostgREST code, or `http_<status>`: never the error's details or hint,
// which carry the failing row.
export class AiCostWriteError extends Error {
  override name = "AiCostWriteError";
}

export function createAiCostWriter(
  client: SupabaseClient<Database>,
): (row: AiCostInsert) => Promise<void> {
  return async (row) => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      // Rejects even when the fetch ignores the abort.
      timer = setTimeout(() => {
        controller.abort();
        reject(new AiCostWriteError("timeout"));
      }, TIMEOUT_MS);
    });
    try {
      const insert = client
        .from("ai_costs")
        // The generated type maps numeric to number; the amount travels as a
        // decimal string so it never passes through a float.
        .insert({ ...row, amount_usd: row.amount_usd as unknown as number })
        .abortSignal(controller.signal);
      const { error, status } = await Promise.race([insert, timeout]);
      if (!error) return;
      if (status === 0) throw new AiCostWriteError("fetch_error");
      throw new AiCostWriteError(
        ERROR_CODE.test(error.code ?? "") ? error.code : `http_${status}`,
      );
    } finally {
      clearTimeout(timer);
    }
  };
}
