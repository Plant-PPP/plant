import type { SupabaseClient } from "@supabase/supabase-js";
import { isSessionMissing } from "@/lib/auth/session-state";

type Auth = Pick<SupabaseClient["auth"], "signOut" | "getSession" | "getUser">;

// Other devices first: auth-js keeps this session when that revoke fails, so
// a retry still has a token to send. auth-js also reports a revoke that Auth
// refused for a dead session as a success, so it then asks Auth about this
// session: when another device had already ended it, nothing was revoked and
// the user signs in again to retry. Then this device, the way the user menu
// signs out.
export async function signOutEverywhere(
  auth: Auth,
  signOutHere: (auth: Auth) => Promise<boolean>,
): Promise<"done" | "others_failed" | "session_ended" | "this_device_failed"> {
  const { error } = await auth.signOut({ scope: "others" });
  if (error) return "others_failed";
  const { error: userError } = await auth.getUser();
  const ended = userError !== null && isSessionMissing(userError);
  if (!(await signOutHere(auth))) {
    return ended ? "others_failed" : "this_device_failed";
  }
  return ended ? "session_ended" : "done";
}
