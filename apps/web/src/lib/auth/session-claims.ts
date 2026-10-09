import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import { mfaRequirement } from "./mfa-rules";
import { MFA_PATH } from "./routes";
import { readSessionClaims } from "./session-claims-unchecked";

// The verified claims of the signed-in user, or a redirect to /login or, for a
// user with TOTP who has not verified it in this session, to /auth/mfa. Every
// page, server action and route handler that touches user data calls it
// itself: the (app) layout's call only guards the UI.
export const getSessionClaims = cache(async () => {
  const claims = await readSessionClaims();
  // The proxy checks this on private paths; this covers the rest: routes
  // outside its matcher, /login and the callback.
  if (mfaRequirement(claims) === "verify") redirect(MFA_PATH);
  return claims;
});
