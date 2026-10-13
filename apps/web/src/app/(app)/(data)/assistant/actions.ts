"use server";

import { z } from "zod";

import type { ChatMessage } from "@/lib/assistant/chat";
import {
  conversationMessages,
  deleteConversation as deleteOwn,
} from "@/lib/assistant/conversations";
import { getSessionClaims } from "@/lib/auth/session-claims";
import { serverLog } from "@/lib/log/server-log";
import { createClient } from "@/lib/supabase/server";

// The arguments come from the browser: each is parsed, and every read and
// write runs as the session's user, under RLS.

const conversationId = z.uuid();

export async function loadConversation(
  id: unknown,
): Promise<ChatMessage[] | null> {
  const parsed = conversationId.safeParse(id);
  if (!parsed.success) return null;
  const claims = await getSessionClaims();
  try {
    const messages = await conversationMessages(
      await createClient(),
      claims.sub,
      parsed.data,
    );
    serverLog.info("assistant.conversation", {
      "enduser.id": claims.sub,
      "plant.assistant.action": "load",
      "plant.outcome": "ok",
      "plant.assistant.message_count": messages.length,
    });
    return messages;
  } catch (error) {
    serverLog.error(
      "assistant.conversation",
      {
        "enduser.id": claims.sub,
        "plant.assistant.action": "load",
        "plant.outcome": "failed",
      },
      error,
    );
    return null;
  }
}

export async function deleteConversation(id: unknown): Promise<boolean> {
  const parsed = conversationId.safeParse(id);
  if (!parsed.success) return false;
  const claims = await getSessionClaims();
  try {
    await deleteOwn(await createClient(), claims.sub, parsed.data);
    serverLog.info("assistant.conversation", {
      "enduser.id": claims.sub,
      "plant.assistant.action": "delete",
      "plant.outcome": "ok",
    });
    return true;
  } catch (error) {
    serverLog.error(
      "assistant.conversation",
      {
        "enduser.id": claims.sub,
        "plant.assistant.action": "delete",
        "plant.outcome": "failed",
      },
      error,
    );
    return false;
  }
}
