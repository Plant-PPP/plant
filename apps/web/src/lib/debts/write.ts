import "server-only";
import { liabilityInputSchema } from "@plant/core";
import type { Database } from "@plant/shared";
import type { SupabaseClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getSessionClaims } from "@/lib/auth/session-claims";
import { serverLog } from "@/lib/log/server-log";
import type {
  WriteResult,
  WriteResultCode,
} from "@/lib/portfolio-setup/write-result";
import { REQUEST_ID_FIELD } from "@/lib/request-id";
import { currentRequestId } from "@/lib/request-id-server";
import { classifyPostgrestResult } from "@/lib/supabase/postgrest-write";
import { createClient } from "@/lib/supabase/server";

type Client = SupabaseClient<Database>;
type Row = Database["public"]["Tables"]["liabilities"]["Insert"];

export type DebtAction =
  "create_liability" | "update_liability" | "delete_liability";

const EVENT = "liabilities.write";

// A CHECK or an instrument that does not exist: the input core admitted
// still broke a rule only the database holds.
const REFUSED = new Set(["23514", "23503"]);

// Creates (no id), updates (an id and an input) or deletes (an id and no
// input) one of the user's debts. An insert must answer with its row; an
// update or delete with exactly one, and none means the id is not the user's.
export async function writeLiability(
  action: DebtAction,
  id: unknown,
  input: unknown,
): Promise<WriteResult> {
  // Outside any try: its redirect to /login or /auth/mfa must propagate.
  const claims = await getSessionClaims();
  const started = performance.now();
  const requestId = await currentRequestId();

  const parsedId =
    action === "create_liability"
      ? null
      : (z.uuid().safeParse(id).data ?? undefined);
  const parsed =
    action === "delete_liability"
      ? null
      : liabilityInputSchema.safeParse(input);

  let result: WriteResult;
  let failure: unknown;
  if (parsedId === undefined || (parsed !== null && !parsed.success)) {
    result = { ok: false, code: "invalid" };
  } else {
    const client: Client = await createClient();
    // Amounts stay decimal strings; the cast is only for the generated types.
    const row = parsed?.data as unknown as Row;
    const response =
      action === "create_liability"
        ? await client.from("liabilities").insert(row).select("id")
        : action === "update_liability"
          ? await client
              .from("liabilities")
              .update(row)
              .eq("id", parsedId!)
              .select("id")
          : await client
              .from("liabilities")
              .delete()
              .eq("id", parsedId!)
              .select("id");
    const refused = classifyPostgrestResult(
      response,
      action === "create_liability" ? 201 : 200,
    );
    const rows = response.data ?? [];
    if (refused) {
      const code: WriteResultCode = REFUSED.has(refused.code)
        ? "invalid"
        : "failed";
      result = { ok: false, code };
      if (code === "failed") failure = response.error;
    } else if (rows.length === 1) {
      result = { ok: true, id: rows[0]!.id };
    } else if (rows.length === 0 && action !== "create_liability") {
      result = { ok: false, code: "not_found" };
    } else {
      result = { ok: false, code: "failed" };
    }
  }

  const outcome = result.ok ? "ok" : result.code;
  const line = {
    [REQUEST_ID_FIELD]: requestId,
    "enduser.id": claims.sub,
    "plant.liability.action": action,
    "plant.liability.duration_ms": Math.round(performance.now() - started),
    "plant.outcome": outcome,
  };
  if (outcome === "failed") serverLog.error(EVENT, line, failure);
  else if (outcome === "ok") serverLog.info(EVENT, line);
  else serverLog.warn(EVENT, line);
  if (outcome !== "invalid") revalidatePath("/debts");
  return result;
}
