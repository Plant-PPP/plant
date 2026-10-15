import "server-only";
import { liabilityEventInputSchema } from "@plant/core";
import {
  CASH_MOVE_GUARD,
  type CashMoveGuardHint,
  type Database,
  LIABILITY_EVENT_GUARD,
  type LiabilityEventGuardHint,
  nonNegativeDecimalSchema,
  PORTFOLIO_SETUP_GUARD,
  type PortfolioSetupGuardHint,
} from "@plant/shared";
import type { SupabaseClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getSessionClaims } from "@/lib/auth/session-claims";
import { serverLog } from "@/lib/log/server-log";
import { REQUEST_ID_FIELD } from "@/lib/request-id";
import { currentRequestId } from "@/lib/request-id-server";
import {
  classifyPostgrestResult,
  knownHint,
} from "@/lib/supabase/postgrest-write";
import { createClient } from "@/lib/supabase/server";

import { DEBTS_WRITE_EVENT } from "./write";

type Client = SupabaseClient<Database>;

export type DebtEventCode =
  | LiabilityEventGuardHint
  | CashMoveGuardHint
  | PortfolioSetupGuardHint
  | "not_found"
  | "invalid"
  | "retry"
  | "failed";

// cashRestored is false when cash a payment took could not go back.
export type DebtEventResult =
  | { ok: true; id: string; cashRestored: boolean }
  | { ok: false; code: DebtEventCode };

const GUARDS = [LIABILITY_EVENT_GUARD, CASH_MOVE_GUARD, PORTFOLIO_SETUP_GUARD];

// The cash holding a payment came from, whether to take the amount from it
// now, and its amount as the page read it.
const debtCashSchema = z
  .object({
    holding_id: z.uuid(),
    take: z.boolean(),
    expected: nonNegativeDecimalSchema.nullable(),
  })
  .strict()
  .nullable();

// What a refused call means to the user: a guard's hint read only against the
// known lists, an id that is not the user's, a deadlock to try again.
function eventCode(failure: { code: string }, hint: unknown): DebtEventCode {
  const guarded = knownHint(GUARDS, failure, hint);
  if (guarded !== undefined) return guarded;
  if (failure.code === "PT404" || failure.code === "23503") return "not_found";
  if (failure.code === "22023" || failure.code === "23514") return "invalid";
  if (failure.code === "40P01") return "retry";
  return "failed";
}

type Call =
  | {
      action: "record_liability_event";
      debtId: unknown;
      event: unknown;
      cash: unknown;
    }
  | {
      action: "update_liability_event";
      eventId: unknown;
      event: unknown;
      cash: unknown;
    }
  | { action: "delete_liability_event"; eventId: unknown };

// Records, edits or deletes one of the user's debt events through its RPC,
// which takes and gives back the cash it moves in the same transaction.
export async function writeLiabilityEvent(
  call: Call,
): Promise<DebtEventResult> {
  // Outside any try: its redirect to /login or /auth/mfa must propagate.
  const claims = await getSessionClaims();
  const started = performance.now();
  const requestId = await currentRequestId();

  const id = z
    .uuid()
    .safeParse(
      call.action === "record_liability_event" ? call.debtId : call.eventId,
    );
  const event =
    call.action === "delete_liability_event"
      ? null
      : liabilityEventInputSchema.safeParse(call.event);
  const cash =
    call.action === "delete_liability_event"
      ? null
      : debtCashSchema.safeParse(call.cash ?? null);

  let result: DebtEventResult;
  let failure: unknown;
  if (!id.success || (event && !event.success) || (cash && !cash.success)) {
    result = { ok: false, code: "invalid" };
  } else {
    const client: Client = await createClient();
    const response =
      call.action === "record_liability_event"
        ? await client.rpc("record_liability_event", {
            p_liability_id: id.data,
            p_event: event!.data!,
            p_cash: cash!
              .data! as Database["public"]["Functions"]["record_liability_event"]["Args"]["p_cash"],
          })
        : call.action === "update_liability_event"
          ? await client.rpc("update_liability_event", {
              p_event_id: id.data,
              p_event: event!.data!,
              p_cash: cash!
                .data! as Database["public"]["Functions"]["update_liability_event"]["Args"]["p_cash"],
            })
          : await client.rpc("delete_liability_event", { p_event_id: id.data });
    const refused = classifyPostgrestResult(response, 200);
    if (refused) {
      const code = eventCode(refused, response.error?.hint);
      result = { ok: false, code };
      if (code === "failed") failure = response.error;
    } else {
      const data = response.data as unknown;
      result =
        call.action === "record_liability_event"
          ? { ok: true, id: String(data), cashRestored: true }
          : { ok: true, id: id.data, cashRestored: data !== false };
    }
  }

  const outcome = result.ok ? "ok" : result.code;
  const line = {
    [REQUEST_ID_FIELD]: requestId,
    "enduser.id": claims.sub,
    "plant.liability.action": call.action,
    "plant.liability.event_kind": event?.success ? event.data.kind : undefined,
    "plant.liability.cash_link": cash?.success ? cash.data !== null : undefined,
    "plant.liability.cash_taken": cash?.success
      ? (cash.data?.take ?? false)
      : undefined,
    "plant.liability.cash_restored":
      result.ok && call.action !== "record_liability_event"
        ? result.cashRestored
        : undefined,
    "plant.liability.duration_ms": Math.round(performance.now() - started),
    "plant.outcome": outcome,
  };
  if (outcome === "failed") serverLog.error(DEBTS_WRITE_EVENT, line, failure);
  else if (outcome === "ok") serverLog.info(DEBTS_WRITE_EVENT, line);
  else serverLog.warn(DEBTS_WRITE_EVENT, line);
  if (outcome !== "invalid") {
    revalidatePath("/debts", "layout");
    revalidatePath("/");
    // Taking cash, or giving back what a payment took, moves a cash holding.
    if (call.action !== "record_liability_event" || cash?.data?.take)
      revalidatePath("/assets", "layout");
  }
  return result;
}
