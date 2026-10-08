import { createBrowserClient } from "@supabase/ssr";
import { requireSupabaseEnv, SESSION_COOKIE_OPTIONS } from "./env";

export function createClient() {
  const env = requireSupabaseEnv();
  return createBrowserClient(env.url, env.anonKey, {
    cookieOptions: SESSION_COOKIE_OPTIONS,
    // proxy.ts refreshes the session before it nears expiry. A refresh here
    // that hits a rate limit after the access token expired deletes the
    // cookies, which would sign the user out. auth-js still refreshes a token
    // it reads as near expiry (a clock ahead of the server's), and that edge
    // stays.
    auth: { autoRefreshToken: false },
  });
}
