import "server-only";
import type { Database } from "@plant/shared";
import type { SupabaseClient } from "@supabase/supabase-js";

import { classifyPostgrestResult } from "@/lib/supabase/postgrest-write";

export type ExportAuditOutcome = "success" | "failure" | "denied";

export class ExportAuditError extends Error {
  constructor(readonly code: string) {
    super(`export audit failed: ${code}`);
  }
}

// Writes the export's audit row; record_data_export writes it for the
// session's user only.
export async function recordExport(
  client: SupabaseClient<Database>,
  outcome: ExportAuditOutcome,
  requestId: string | undefined,
): Promise<void> {
  const result = await client.rpc("record_data_export", {
    p_outcome: outcome,
    ...(requestId === undefined ? {} : { p_request_id: requestId }),
  });
  const failure = classifyPostgrestResult(result, [200, 204]);
  if (failure) throw new ExportAuditError(failure.code);
}
