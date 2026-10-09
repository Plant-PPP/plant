import type { SupabaseClient } from "@supabase/supabase-js";

type Auth = Pick<SupabaseClient["auth"], "signOut" | "getSession">;

// Other devices first: auth-js keeps this session when that revoke fails, so
// a retry still has a token to send. Then this device, the way the user menu
// signs out.
export async function signOutEverywhere(
  auth: Auth,
  signOutHere: (auth: Auth) => Promise<boolean>,
): Promise<"done" | "others_failed" | "this_device_failed"> {
  const { error } = await auth.signOut({ scope: "others" });
  if (error) return "others_failed";
  return (await signOutHere(auth)) ? "done" : "this_device_failed";
}
