import type { SupabaseClient } from "@supabase/supabase-js";
import { isSessionMissing } from "@/lib/auth/session-state";

type Auth = Pick<SupabaseClient["auth"], "signOut" | "getSession" | "getUser">;

export type SignOutEverywhereOutcome =
  "done" | "others_failed" | "session_ended" | "this_device_failed";

// Other devices first, then this one the way the user menu signs out. When
// this session had already ended (another device, a timeout), nothing was
// revoked and the user signs in again to retry. auth-js reports Auth's
// refusal of a dead session's revoke as a success, so Auth is asked about the
// session after it.
// Any other failure, of the revoke or of that check, keeps this session for a
// retry: the revoke cannot be confirmed.
export async function signOutEverywhere(
  auth: Auth,
  signOutHere: (auth: Auth) => Promise<boolean>,
): Promise<SignOutEverywhereOutcome> {
  const { error: revokeError } = await auth.signOut({ scope: "others" });
  const error = revokeError ?? (await auth.getUser()).error;
  if (error && !isSessionMissing(error)) return "others_failed";
  const ended = error !== null;
  if (!(await signOutHere(auth))) {
    return ended ? "others_failed" : "this_device_failed";
  }
  return ended ? "session_ended" : "done";
}
