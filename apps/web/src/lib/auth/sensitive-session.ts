import "server-only";
import { headers } from "next/headers";
import { serverLog } from "@/lib/log/server-log";
import {
  REQUEST_ID_FIELD,
  REQUEST_ID_HEADER,
  requestIdFrom,
} from "@/lib/request-id";
import { sensitiveRequirement } from "./mfa-rules";
import { getSessionClaims } from "./session-claims";

export type SensitiveAction =
  "export" | "delete_account" | "change_email" | "disable_mfa";

const nowS = () => Math.floor(Date.now() / 1000);

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

// Called by the server action, or the code that enqueues the job, behind an
// export (PLA-58), an account deletion (PLA-84), an email change or turning
// MFA off. On sign_in_again their UI asks the user to sign in again.
export async function requireSensitiveSession(
  action: SensitiveAction,
): Promise<SensitiveAnswer> {
  const claims = await getSessionClaims();
  if (sensitiveRequirement(claims, nowS()) === "met") {
    return { ok: true, session: { userId: claims.sub } as SensitiveSession };
  }
  serverLog.info("auth.step_up", {
    [REQUEST_ID_FIELD]: requestIdFrom((await headers()).get(REQUEST_ID_HEADER)),
    "enduser.id": claims.sub,
    "plant.outcome": "step_up_required",
    "plant.auth.sensitive_action": action,
  });
  return { ok: false, stepUp: "sign_in_again" };
}

// For a screen choosing what to ask first; the action behind it still calls
// requireSensitiveSession.
export async function needsStepUp(): Promise<boolean> {
  return sensitiveRequirement(await getSessionClaims(), nowS()) !== "met";
}
