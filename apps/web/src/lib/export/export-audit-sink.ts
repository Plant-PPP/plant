import "server-only";

import { requireSensitiveSession } from "@/lib/auth/sensitive-session";
import { getSessionClaims } from "@/lib/auth/session-claims";
import type { ExportTable } from "@/lib/export/csv";
import type { ExportAnswer } from "@/lib/export/tables";
import { serverLog } from "@/lib/log/server-log";
import { userLimiter } from "@/lib/reports/limit";
import { REQUEST_ID_FIELD } from "@/lib/request-id";
import { currentRequestId } from "@/lib/request-id-server";
import { classifyPostgrestResult } from "@/lib/supabase/postgrest-write";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

type ExportAuditOutcome = "success" | "failure" | "denied";

class ExportAuditError extends Error {
  constructor(readonly code: string) {
    super(`export audit failed: ${code}`);
  }
}

// Writes the export's audit row past RLS, for the user of the session's
// verified claims.
async function recordExport(
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

// Each export reads everything the user has, so a user gets five a minute. In
// memory, per serverless instance.
const limit = userLimiter({ perUser: 5 });

// The session's user's export, read once the limit and the step-up let it
// through. Each try past the limit leaves an audit row with the outcome this
// function decides, and the tables go out only once theirs is written. Only
// the settings actions may import it: it takes no user id and no outcome.
export async function auditedExport(
  read: () => Promise<{ tables: ExportTable[]; truncated: boolean }>,
): Promise<ExportAnswer> {
  const requestId = await currentRequestId();
  const claims = await getSessionClaims();
  const started = performance.now();
  const line = (outcome: string) => ({
    [REQUEST_ID_FIELD]: requestId,
    "enduser.id": claims.sub,
    "plant.outcome": outcome,
    "plant.duration_ms": Math.round(performance.now() - started),
  });
  const failed = (step: "audit" | "read", error: unknown) =>
    serverLog.error(
      "settings.export",
      { ...line("failed"), "plant.export.step": step },
      error,
    );

  if (!limit(claims.sub)) {
    serverLog.warn("settings.export", line("limited"));
    return { limited: true };
  }
  const gate = await requireSensitiveSession("export");
  if (!gate.ok) {
    await recordExport("denied", requestId).catch((error: unknown) =>
      failed("audit", error),
    );
    return { stepUp: gate.stepUp };
  }
  let answer: { tables: ExportTable[]; truncated: boolean };
  try {
    answer = await read();
  } catch (error) {
    failed("read", error);
    await recordExport("failure", requestId).catch((auditError) =>
      failed("audit", auditError),
    );
    return null;
  }
  try {
    await recordExport("success", requestId);
  } catch (error) {
    failed("audit", error);
    return null;
  }
  serverLog.info("settings.export", {
    ...line("ok"),
    "plant.export.truncated": answer.truncated,
    "plant.export.row_count": answer.tables.reduce(
      (sum, table) => sum + table.rows.length,
      0,
    ),
  });
  return answer;
}
