import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { mfaRequirement } from "./mfa-rules";
import { LOGIN_PATH, MFA_PATH } from "./routes";
import {
  AuthUnavailableError,
  isSessionMissing,
  unavailableReason,
} from "./session-state";

// The verified claims of the signed-in user, or a redirect to /login or, for a
// user with TOTP who has not verified it in this session, to /auth/mfa. Every
// page, server action and route handler that touches user data calls it
// itself: the (app) layout's call only guards the UI.
export const getSessionClaims = cache(async () => {
  // proxy.ts already failed to refresh, or found the token without the MFA
  // claim. After a failed refresh, a second attempt in a route handler or
  // server action would delete the session cookies on the same failure.
  const reason = unavailableReason(await headers());
  if (reason) throw new AuthUnavailableError(reason);
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (data?.claims) {
    // The proxy already redirected or flagged these; this covers routes
    // outside its matcher.
    const requirement = mfaRequirement(data.claims);
    if (requirement === "verify") redirect(MFA_PATH);
    if (requirement === "claim_missing") {
      throw new AuthUnavailableError("mfa_claim_missing");
    }
    return data.claims;
  }
  // The proxy already sent the visitor to /login with `next`; this covers a
  // session that expired between the two.
  if (isSessionMissing(error)) redirect(LOGIN_PATH);
  throw error;
});
