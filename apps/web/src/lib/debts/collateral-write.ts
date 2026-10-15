import "server-only";
import type { Database } from "@plant/shared";
import type { SupabaseClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getSessionClaims } from "@/lib/auth/session-claims";
import { serverLog } from "@/lib/log/server-log";
import { PAGE_ROW_LIMIT } from "@/lib/portfolio-setup/limits";
import type { WriteResult } from "@/lib/portfolio-setup/write-result";
import { REQUEST_ID_FIELD } from "@/lib/request-id";
import { currentRequestId } from "@/lib/request-id-server";
import { classifyPostgrestResult } from "@/lib/supabase/postgrest-write";
import { createClient } from "@/lib/supabase/server";

import { DEBTS_WRITE_EVENT } from "./write";

type Client = SupabaseClient<Database>;

const holdingIdsSchema = z.array(z.uuid()).max(PAGE_ROW_LIMIT);

// Leaves exactly `holdingIds` pledged for one of the user's debts: removes
// the rest, then adds what is missing. Each step stands on its own, so a
// retry after a failure ends in the same set. Another user's debt or holding
// is refused by the foreign keys as not found.
export async function writeCollateral(
  debtId: unknown,
  holdingIds: unknown,
): Promise<WriteResult> {
  // Outside any try: its redirect to /login or /auth/mfa must propagate.
  const claims = await getSessionClaims();
  const started = performance.now();
  const requestId = await currentRequestId();
  const id = z.uuid().safeParse(debtId);
  const ids = holdingIdsSchema.safeParse(holdingIds);

  let result: WriteResult;
  let failure: unknown;
  if (!id.success || !ids.success) {
    result = { ok: false, code: "invalid" };
  } else {
    const client: Client = await createClient();
    const wanted = [...new Set(ids.data)];
    const current = await client
      .from("liability_collateral")
      .select("holding_id")
      .eq("liability_id", id.data);
    const removed =
      classifyPostgrestResult(current, 200) ??
      classifyPostgrestResult(
        await (wanted.length === 0
          ? client
              .from("liability_collateral")
              .delete()
              .eq("liability_id", id.data)
          : client
              .from("liability_collateral")
              .delete()
              .eq("liability_id", id.data)
              .not("holding_id", "in", `(${wanted.join(",")})`)),
        204,
      );
    const held = new Set((current.data ?? []).map((row) => row.holding_id));
    const missing = wanted.filter((holding) => !held.has(holding));
    const added =
      removed ??
      (missing.length === 0
        ? null
        : classifyPostgrestResult(
            await client.from("liability_collateral").insert(
              missing.map((holding) => ({
                liability_id: id.data,
                holding_id: holding,
              })),
            ),
            201,
          ));
    if (added) {
      result = {
        ok: false,
        code: added.code === "23503" ? "not_found" : "failed",
      };
      if (result.code === "failed") failure = added;
    } else {
      result = { ok: true, id: id.data };
    }
  }

  const outcome = result.ok ? "ok" : result.code;
  const line = {
    [REQUEST_ID_FIELD]: requestId,
    "enduser.id": claims.sub,
    "plant.liability.action": "set_collateral",
    "plant.liability.collateral_count": ids.success
      ? ids.data.length
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
