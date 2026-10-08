import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { LOGIN_PATH } from "./routes";
import {
  AUTH_UNAVAILABLE_HEADER,
  AuthUnavailableError,
  isSessionMissing,
} from "./session-state";

// The verified claims of the signed-in user, or a redirect to /login. Every
// page, server action and route handler that touches user data calls it
// itself: the (app) layout's call only guards the UI.
export const getSessionClaims = cache(async () => {
  // proxy.ts already failed to refresh. A second attempt in a route handler
  // or server action would delete the session cookies on the same failure.
  if ((await headers()).get(AUTH_UNAVAILABLE_HEADER)) {
    throw new AuthUnavailableError();
  }
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (data?.claims) return data.claims;
  // The proxy already sent the visitor to /login with `next`; this covers a
  // session that expired between the two.
  if (isSessionMissing(error)) redirect(LOGIN_PATH);
  throw error;
});
