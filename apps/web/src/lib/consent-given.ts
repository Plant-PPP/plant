import "server-only";
import type { Database } from "@plant/shared";
import type { SupabaseClient } from "@supabase/supabase-js";

import { CONSENT_VERSION } from "@/lib/consent";
import { classifyPostgrestResult } from "@/lib/supabase/postgrest-write";

type ConsentKind = Database["public"]["Enums"]["consent_kind"];

// What sending a user's data to an AI provider takes: their file on Cargar,
// their question to the assistant.
export const AI_CONSENTS = ["terms", "ai_providers"] as const;

// Whether the latest row of each kind is a grant of the version in force: a
// later row withdrawing one takes it back.
export async function consentsGiven(
  client: SupabaseClient<Database>,
  kinds: readonly ConsentKind[],
): Promise<boolean> {
  const latest = await Promise.all(
    kinds.map(async (kind) => {
      const result = await client
        .from("consents")
        .select("version, granted")
        .eq("kind", kind)
        .order("accepted_at", { ascending: false })
        .limit(1);
      if (classifyPostgrestResult(result, 200) || !result.data) {
        throw new Error("consents read failed");
      }
      return result.data[0];
    }),
  );
  return latest.every(
    (row) => row?.granted === true && row.version === CONSENT_VERSION,
  );
}
