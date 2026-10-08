import "server-only";
import type { AiCostInsert } from "@plant/shared";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { AiCostWriteError, createAiCostWriter } from "./ai-cost-writer";

// Writes a cost row for whatever user_id it is given, past RLS: only route
// handlers may import it, and never from a "use server" file.
export function aiCostSink(): (row: AiCostInsert) => Promise<void> {
  const client = createServiceRoleClient();
  if (!client) {
    return () => Promise.reject(new AiCostWriteError("missing_key"));
  }
  return createAiCostWriter(client);
}
