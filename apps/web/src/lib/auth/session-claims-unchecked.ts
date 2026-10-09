import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { mfaRequirement } from "./mfa-rules";
import { LOGIN_PATH } from "./routes";
import {
  AuthUnavailableError,
  isSessionMissing,
  unavailableReason,
} from "./session-state";

// The verified claims of the signed-in user, or a redirect to /login, without
// sending a session that still has to verify its factor to /auth/mfa. Only
// /auth/mfa itself reads claims this way (lint keeps everyone else on
// getSessionClaims): the proxy lets such a session through there, so that
// page defines and imports no server action.
export const readSessionClaims = cache(async () => {
  // proxy.ts already failed to refresh, or found the token without the MFA
  // claim. After a failed refresh, a second attempt in a route handler or
  // server action would delete the session cookies on the same failure.
  const reason = unavailableReason(await headers());
  if (reason) throw new AuthUnavailableError(reason);
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (data?.claims) {
    if (mfaRequirement(data.claims) === "claim_missing") {
      throw new AuthUnavailableError("mfa_claim_missing");
    }
    return data.claims;
  }
  // The proxy already sent the visitor to /login with `next`; this covers a
  // session that expired between the two.
  if (isSessionMissing(error)) redirect(LOGIN_PATH);
  throw error;
});
