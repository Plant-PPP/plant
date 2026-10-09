import type { SupabaseClient } from "@supabase/supabase-js";
import { isSessionMissing } from "@/lib/auth/session-state";

type Auth = Pick<SupabaseClient["auth"], "signOut" | "getSession" | "getUser">;

// auth-js reports a revoke that Auth refused for a dead session as a success,
// so Auth checks this session first: when another device already ended it,
// the user signs in again and retries from there. Then other devices: auth-js
// keeps this session when that revoke fails, so a retry still has a token to
// send. Then this device, the way the user menu signs out.
export async function signOutEverywhere(
  auth: Auth,
  signOutHere: (auth: Auth) => Promise<boolean>,
): Promise<"done" | "others_failed" | "session_ended" | "this_device_failed"> {
  const { error: userError } = await auth.getUser();
  if (userError) {
    if (!isSessionMissing(userError)) return "others_failed";
    return (await signOutHere(auth)) ? "session_ended" : "this_device_failed";
  }
  const { error } = await auth.signOut({ scope: "others" });
  if (error) return "others_failed";
  return (await signOutHere(auth)) ? "done" : "this_device_failed";
}
