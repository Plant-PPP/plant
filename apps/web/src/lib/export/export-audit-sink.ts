import "server-only";

import { getSessionClaims } from "@/lib/auth/session-claims";
import { classifyPostgrestResult } from "@/lib/supabase/postgrest-write";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export type ExportAuditOutcome = "success" | "failure" | "denied";

export class ExportAuditError extends Error {
  constructor(readonly code: string) {
    super(`export audit failed: ${code}`);
  }
}

// Writes the export's audit row past RLS, for the user of the session's
// verified claims: it takes no user id, so no caller can name another one.
// Only the settings actions may import it.
export async function recordExport(
  outcome: ExportAuditOutcome,
  requestId: string | undefined,
): Promise<void> {
  const client = createServiceRoleClient();
  if (!client) throw new ExportAuditError("unconfigured");
  const { sub } = await getSessionClaims();
  const result = await client.rpc("audit_data_export", {
    p_user_id: sub,
    p_outcome: outcome,
    ...(requestId === undefined ? {} : { p_request_id: requestId }),
  });
  const failure = classifyPostgrestResult(result, [200, 204]);
  if (failure) throw new ExportAuditError(failure.code);
}
