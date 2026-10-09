import "server-only";
import type { AiCostInsert, Database } from "@plant/shared";
import type { SupabaseClient } from "@supabase/supabase-js";

const TIMEOUT_MS = 1500;
const ERROR_CODE = /^(?:[0-9A-Z]{5}|PGRST\d+)$/;

// `code` is one of `timeout`, `fetch_error`, `missing_key`, a SQLSTATE or
// PostgREST code, or `http_<status>`: never the error's details or hint,
// which carry the failing row. `mayHaveCommitted` is true after a timeout, a
// failed connection or a 5xx, when the insert may have committed before the
// answer was lost; any other failure wrote nothing.
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
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      // Rejects even when the fetch ignores the abort.
      timer = setTimeout(() => {
        controller.abort();
        reject(new AiCostWriteError("timeout", true));
      }, TIMEOUT_MS);
    });
    try {
      const insert = client
        .from("ai_costs")
        // See AiCostInsert: the amount stays a decimal string.
        .insert({ ...row, amount_usd: row.amount_usd as unknown as number })
        .abortSignal(controller.signal);
      const { error, status } = await Promise.race([insert, timeout]);
      // PostgREST answers an insert with 201. postgrest-js reports some other
      // answers as success (a 404 with an empty body becomes a 204), and the
      // error of a failed one can be falsy, so only the status decides.
      if (status === 201) return;
      if (status === 0) throw new AiCostWriteError("fetch_error", true);
      const code = typeof error?.code === "string" ? error.code : "";
      throw new AiCostWriteError(
        ERROR_CODE.test(code) ? code : `http_${status}`,
        status >= 500,
      );
    } finally {
      clearTimeout(timer);
    }
  };
}
