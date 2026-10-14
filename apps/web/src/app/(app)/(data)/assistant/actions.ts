"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import type { ChatMessage, PinResult } from "@/lib/assistant/chat";
import {
  conversationMessages,
  deleteConversation as deleteOwn,
} from "@/lib/assistant/conversations";
import {
  pinChart as pinOwn,
  pinSourceSchema,
  unpinChart as unpinOwn,
} from "@/lib/assistant/pins";
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

// Pins one of the assistant's charts to Resumen, by which chart it is.
export async function pinChart(source: unknown): Promise<PinResult> {
  const parsed = pinSourceSchema.safeParse(source);
  if (!parsed.success) return "failed";
  const claims = await getSessionClaims();
  let result: PinResult;
  let failure: unknown;
  try {
    result = await pinOwn(await createClient(), parsed.data);
  } catch (error) {
    result = "failed";
    failure = error;
  }
  const line = {
    "enduser.id": claims.sub,
    "plant.assistant.action": "pin",
    "plant.assistant.chart_topic": parsed.data.topic,
    "plant.outcome": result,
  };
  if (result === "failed") serverLog.error("assistant.pin", line, failure);
  else serverLog.info("assistant.pin", line);
  if (result === "pinned") revalidatePath("/");
  return result;
}

export async function unpinChart(id: unknown): Promise<boolean> {
  const parsed = conversationId.safeParse(id);
  if (!parsed.success) return false;
  const claims = await getSessionClaims();
  try {
    const removed = await unpinOwn(await createClient(), parsed.data);
    serverLog.info("assistant.pin", {
      "enduser.id": claims.sub,
      "plant.assistant.action": "unpin",
      "plant.outcome": removed ? "ok" : "not_found",
    });
    revalidatePath("/");
    // A pin already gone, as one unpinned in another tab, is unpinned too.
    return true;
  } catch (error) {
    serverLog.error(
      "assistant.pin",
      {
        "enduser.id": claims.sub,
        "plant.assistant.action": "unpin",
        "plant.outcome": "failed",
      },
      error,
    );
    return false;
  }
}
