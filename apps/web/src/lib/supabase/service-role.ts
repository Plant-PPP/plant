import "server-only";
import type { Database } from "@plant/shared";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { supabaseEnv } from "./env";

// The secret key bypasses RLS, signs in as any user through the Auth admin API
// and skips Storage policies. Only the sinks may import this module:
// ai-cost-sink.ts and quote-sink.ts.
export function createServiceRoleClient(): SupabaseClient<Database> | null {
  const url = supabaseEnv()?.url;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
