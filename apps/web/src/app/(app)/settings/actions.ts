"use server";

import { headers } from "next/headers";
import {
  type DisableOutcome,
  logDisable,
  unenrollForSession,
} from "@/lib/auth/mfa-disable";
import { requireSensitiveSession } from "@/lib/auth/sensitive-session";
import { getSessionClaims } from "@/lib/auth/session-claims";
import { REQUEST_ID_HEADER, requestIdFrom } from "@/lib/request-id";
import { createClient } from "@/lib/supabase/server";

export type DisableResult =
  { outcome: DisableOutcome } | { stepUp: "sign_in_again" };

// Turns MFA off once the user signed in within the step-up window and the
// dialog verified a TOTP code just before. factorId comes from the browser:
// unenrollForSession accepts only one of the session user's own factors.
export async function disableTotp(factorId: unknown): Promise<DisableResult> {
  const requestId = requestIdFrom((await headers()).get(REQUEST_ID_HEADER));
  if (typeof factorId !== "string") {
    return logDisable("invalid_input", { requestId });
  }
  const gate = await requireSensitiveSession("disable_mfa");
  if (!gate.ok) return { stepUp: gate.stepUp };
  return unenrollForSession({
    session: gate.session,
    claims: await getSessionClaims(),
    client: await createClient(),
    factorId,
    requestId,
  });
}
