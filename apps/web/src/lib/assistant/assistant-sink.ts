import "server-only";
import type { Database } from "@plant/shared";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { classifyPostgrestResult } from "@/lib/supabase/postgrest-write";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

import {
  type AssistantStore,
  AssistantStoreError,
  type StoredMessage,
} from "./store";

type Client = SupabaseClient<Database>;
type Parts = Database["public"]["Tables"]["ai_messages"]["Insert"]["parts"];

const storedSchema = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant"]),
  parts: z.array(z.unknown()),
  metadata: z.record(z.string(), z.unknown()).nullable(),
});

function checked(
  step: AssistantStoreError["step"],
  result: Parameters<typeof classifyPostgrestResult>[0],
  expected: number,
) {
  const failure = classifyPostgrestResult(result, expected);
  if (failure) throw new AssistantStoreError(step, failure.code);
}

// The chat route's store over a service-role client: it bypasses RLS, so every
// call filters by the user.
export function createAssistantStore(client: Client): AssistantStore {
  return {
    async reserveQuestion(userId) {
      const result = await client
        .from("ai_questions")
        .insert({ user_id: userId });
      const failure = classifyPostgrestResult(result, 201);
      if (failure?.code === "PT429") return "quota";
      if (failure) throw new AssistantStoreError("reserve", failure.code);
      return "ok";
    },

    async conversation(userId, id) {
      const result = await client
        .from("ai_conversations")
        .select("unit")
        .eq("user_id", userId)
        .eq("id", id)
        .limit(1);
      checked("conversation", result, 200);
      const row = result.data?.[0];
      return row ? { unit: row.unit } : null;
    },

    async startConversation(userId, { id, title, unit }) {
      const result = await client
        .from("ai_conversations")
        .upsert(
          { user_id: userId, id, title, unit },
          { onConflict: "user_id,id", ignoreDuplicates: true },
        );
      checked("start", result, 201);
    },

    // A turn's messages are written together and share created_at; the
    // question goes before its answer.
    async history(userId, conversationId, turns) {
      const result = await client
        .from("ai_messages")
        .select("id, role, parts, metadata")
        .eq("user_id", userId)
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: false })
        .order("role", { ascending: true })
        .order("id", { ascending: false })
        .limit(turns * 2);
      checked("history", result, 200);
      const rows = z.array(storedSchema).safeParse(result.data ?? []);
      if (!rows.success)
        throw new AssistantStoreError("history", "invalid_row");
      return rows.data.reverse();
    },

    async saveTurn(userId, { conversationId, messages }) {
      const inserted = await client.from("ai_messages").insert(
        messages.map((message: StoredMessage) => ({
          user_id: userId,
          id: message.id,
          conversation_id: conversationId,
          role: message.role,
          parts: message.parts as Parts,
          metadata: message.metadata as Parts | null,
        })),
      );
      checked("save", inserted, 201);

      // Counted, not incremented, so two turns at once both land.
      const asked = await client
        .from("ai_messages")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("conversation_id", conversationId)
        .eq("role", "user");
      checked("save", asked, 200);

      const updated = await client
        .from("ai_conversations")
        .update({ questions: asked.count ?? 0 })
        .eq("user_id", userId)
        .eq("id", conversationId);
      checked("save", updated, 204);
    },
  };
}

// Reads and writes any user's conversations and spends their questions, past
// RLS: only the chat route may import it.
export function assistantSink(): AssistantStore {
  const client = createServiceRoleClient();
  if (!client) {
    const unconfigured = (step: AssistantStoreError["step"]) => () =>
      Promise.reject(new AssistantStoreError(step, "unconfigured"));
    return {
      reserveQuestion: unconfigured("reserve"),
      conversation: unconfigured("conversation"),
      startConversation: unconfigured("start"),
      history: unconfigured("history"),
      saveTurn: unconfigured("save"),
    };
  }
  return createAssistantStore(client);
}
