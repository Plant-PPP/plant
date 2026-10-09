import "server-only";
import { serverLog } from "@/lib/log/server-log";
import { REQUEST_ID_FIELD } from "@/lib/request-id";
import { sensitiveRequirement, unixNow } from "./mfa-rules";
import { getSessionClaims } from "./session-claims";
import { currentRequestId } from "@/lib/request-id-server";

export type SensitiveAction =
  "export" | "delete_account" | "change_email" | "disable_mfa";

declare const checked: unique symbol;

// Proof that requireSensitiveSession let this request through: an action that
// takes one cannot be called without the check, short of a cast.
export type SensitiveSession = {
  readonly userId: string;
  readonly [checked]: true;
};

export type SensitiveAnswer =
  | { ok: true; session: SensitiveSession }
  | { ok: false; stepUp: "sign_in_again" };

// Called by the server action, or the code that enqueues the job, behind each
// SensitiveAction. On sign_in_again its UI asks the user to sign in again.
export async function requireSensitiveSession(
  action: SensitiveAction,
): Promise<SensitiveAnswer> {
  const claims = await getSessionClaims();
  if (sensitiveRequirement(claims, unixNow()) === "met") {
    return { ok: true, session: { userId: claims.sub } as SensitiveSession };
  }
  serverLog.info("auth.step_up", {
    [REQUEST_ID_FIELD]: await currentRequestId(),
    "enduser.id": claims.sub,
    "plant.outcome": "step_up_required",
    "plant.auth.sensitive_action": action,
  });
  return { ok: false, stepUp: "sign_in_again" };
}

// For a screen choosing what to ask first; the action behind it still calls
// requireSensitiveSession.
export async function needsStepUp(): Promise<boolean> {
  return sensitiveRequirement(await getSessionClaims(), unixNow()) !== "met";
}
