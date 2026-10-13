import "server-only";
import {
  buenosAiresDate,
  buenosAiresMonthStart,
  type Database,
} from "@plant/shared";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { ChatMessage, ConversationSummary } from "./chat";
import { toChatMessages } from "./messages-view";

type Client = SupabaseClient<Database>;

// The conversations the history lists, newest first.
const CONVERSATIONS_LISTED = 50;
// The most messages a reopened conversation shows.
const MESSAGES_SHOWN = 200;

// The user's own conversations, through the session's client under RLS.
export async function listConversations(
  client: Client,
  userId: string,
): Promise<ConversationSummary[]> {
  const { data, error } = await client
    .from("ai_conversations")
    .select("id, title, unit, questions, updated_at")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(CONVERSATIONS_LISTED);
  if (error) throw error;
  return data.map((row) => ({
    id: row.id,
    title: row.title,
    unit: row.unit,
    updatedOn: buenosAiresDate(new Date(row.updated_at)),
    questions: row.questions,
  }));
}

// How many questions the user asked this calendar month in Buenos Aires,
// deleted conversations' included.
export async function questionsThisMonth(
  client: Client,
  userId: string,
  today: string,
): Promise<number> {
  const { count, error } = await client
    .from("ai_questions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("asked_at", buenosAiresMonthStart(today));
  if (error) throw error;
  return count ?? 0;
}

// A conversation's messages, oldest first; none for a conversation that is
// not the user's.
export async function conversationMessages(
  client: Client,
  userId: string,
  conversationId: string,
): Promise<ChatMessage[]> {
  const { data, error } = await client
    .from("ai_messages")
    .select("id, role, parts, metadata")
    .eq("user_id", userId)
    .eq("conversation_id", conversationId)
    // The newest first, then turned around; a turn's question and answer are
    // written together, the question first.
    .order("created_at", { ascending: false })
    .order("role", { ascending: true })
    .order("id", { ascending: false })
    .limit(MESSAGES_SHOWN);
  if (error) throw error;
  return toChatMessages(
    data.reverse().map((row) => ({
      ...row,
      parts: Array.isArray(row.parts) ? row.parts : [],
    })),
  );
}

export async function deleteConversation(
  client: Client,
  userId: string,
  conversationId: string,
): Promise<void> {
  const { error } = await client
    .from("ai_conversations")
    .delete()
    .eq("user_id", userId)
    .eq("id", conversationId);
  if (error) throw error;
}
