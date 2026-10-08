// Literal process.env reads, so Next inlines the values into the browser bundle.
export function supabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  return { url, anonKey };
}

export function requireSupabaseEnv() {
  const env = supabaseEnv();
  if (!env) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY; run pnpm env:local",
    );
  }
  return env;
}

// The session cookies carry the refresh token, so they never travel over
// plain http once deployed; `next dev` serves http on localhost.
export const SESSION_COOKIE_OPTIONS = {
  secure: process.env.NODE_ENV === "production",
};
