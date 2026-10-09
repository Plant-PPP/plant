import type { SupabaseClient } from "@supabase/supabase-js";

export type AuthClient = Pick<SupabaseClient, "auth">;

// The user's verified factors, and the TOTP ones among them. Throws on an
// error, so a failed load never reads as "no factor" to an enrolled user.
export async function listVerifiedFactors(client: AuthClient) {
  const { data, error } = await client.auth.mfa.listFactors();
  if (error) throw error;
  return {
    verified: data.all.filter((factor) => factor.status === "verified"),
    totp: data.totp,
  };
}
