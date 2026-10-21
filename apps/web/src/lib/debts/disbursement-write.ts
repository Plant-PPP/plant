import "server-only";
import type { Database } from "@plant/shared";
import type { SupabaseClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getSessionClaims } from "@/lib/auth/session-claims";
import { serverLog } from "@/lib/log/server-log";
import type { WriteResult } from "@/lib/portfolio-setup/write-result";
import { REQUEST_ID_FIELD } from "@/lib/request-id";
import { currentRequestId } from "@/lib/request-id-server";
import { classifyPostgrestResult } from "@/lib/supabase/postgrest-write";
import { createClient } from "@/lib/supabase/server";

import { DEBTS_WRITE_EVENT } from "./write";

type Client = SupabaseClient<Database>;

// Names the operation that brought one of the user's debts' money in, or
// none. A debt or an operation that is not the user's answers not found.
export async function writeDisbursement(
  debtId: unknown,
  operationId: unknown,
): Promise<WriteResult> {
  // Outside any try: its redirect to /login or /auth/mfa must propagate.
  const claims = await getSessionClaims();
  const started = performance.now();
  const requestId = await currentRequestId();
  const id = z.uuid().safeParse(debtId);
  const operation = z.uuid().nullable().safeParse(operationId);

  let result: WriteResult;
  let failure: unknown;
  if (!id.success || !operation.success) {
    result = { ok: false, code: "invalid" };
  } else {
    const client: Client = await createClient();
    const updated = await client
      .from("liabilities")
      .update({ disbursement_operation_id: operation.data })
      .eq("id", id.data)
      .select("id");
    const refused = classifyPostgrestResult(updated, 200);
    if (refused) {
      result = {
        ok: false,
        code: refused.code === "23503" ? "not_found" : "failed",
      };
      if (result.code === "failed") failure = refused;
    } else if ((updated.data ?? []).length === 0) {
      result = { ok: false, code: "not_found" };
    } else {
      result = { ok: true, id: id.data };
    }
  }

  const outcome = result.ok ? "ok" : result.code;
  const line = {
    [REQUEST_ID_FIELD]: requestId,
    "enduser.id": claims.sub,
    "plant.liability.action": "set_disbursement",
    "plant.liability.id": id.success ? id.data : undefined,
    "plant.liability.duration_ms": Math.round(performance.now() - started),
    "plant.outcome": outcome,
  };
  if (outcome === "failed") serverLog.error(DEBTS_WRITE_EVENT, line, failure);
  else if (outcome === "ok") serverLog.info(DEBTS_WRITE_EVENT, line);
  else serverLog.warn(DEBTS_WRITE_EVENT, line);
  if (outcome !== "invalid") revalidatePath("/", "layout");
  return result;
}
