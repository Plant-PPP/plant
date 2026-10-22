import "server-only";
import { installmentsInputSchema } from "@plant/core";
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

// Replaces the whole installment plan of one of the user's debts in one
// transaction. A debt that is not the user's answers not found.
export async function writeInstallments(
  debtId: unknown,
  installments: unknown,
): Promise<WriteResult> {
  // Outside any try: its redirect to /login or /auth/mfa must propagate.
  const claims = await getSessionClaims();
  const started = performance.now();
  const requestId = await currentRequestId();
  const id = z.uuid().safeParse(debtId);
  const plan = installmentsInputSchema.safeParse(installments);

  let result: WriteResult;
  let failure: unknown;
  if (!id.success || !plan.success) {
    result = { ok: false, code: "invalid" };
  } else {
    const client: Client = await createClient();
    const response = await client.rpc("replace_liability_installments", {
      p_liability_id: id.data,
      p_installments: plan.data,
    });
    const refused = classifyPostgrestResult(response, 200);
    if (!refused) {
      result = { ok: true, id: id.data };
    } else if (refused.code === "PT404" || refused.code === "23503") {
      result = { ok: false, code: "not_found" };
    } else if (refused.code === "22023" || refused.code === "23514") {
      result = { ok: false, code: "invalid" };
    } else {
      result = { ok: false, code: "failed" };
      failure = response.error;
    }
  }

  const outcome = result.ok ? "ok" : result.code;
  const line = {
    [REQUEST_ID_FIELD]: requestId,
    "enduser.id": claims.sub,
    "plant.liability.action": "replace_installments",
    "plant.liability.id": id.success ? id.data : undefined,
    "plant.liability.installment_count": plan.success
      ? plan.data.length
      : undefined,
    "plant.liability.duration_ms": Math.round(performance.now() - started),
    "plant.outcome": outcome,
  };
  if (outcome === "failed") serverLog.error(DEBTS_WRITE_EVENT, line, failure);
  else if (outcome === "ok") serverLog.info(DEBTS_WRITE_EVENT, line);
  else serverLog.warn(DEBTS_WRITE_EVENT, line);
  if (outcome !== "invalid") revalidatePath("/debts", "layout");
  return result;
}
