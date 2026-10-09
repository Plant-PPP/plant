import type { SupabaseClient } from "@supabase/supabase-js";

// Signs this device out and says whether it is. When only the revoke fails,
// auth-js has already cleared this device's session, so it is signed out all
// the same; the server keeps that session until it expires. A failure to load
// the session (Auth down with an expired token) leaves the cookies.
export async function signOutAndConfirm(
  auth: Pick<SupabaseClient["auth"], "signOut" | "getSession">,
): Promise<boolean> {
  const { error } = await auth.signOut({ scope: "local" });
  if (!error) return true;
  const after = await auth.getSession();
  return !after.data.session && !after.error;
}
