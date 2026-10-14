"use client";

import { useChat } from "@ai-sdk/react";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import {
  deleteConversation,
  loadConversation,
} from "@/app/(app)/(data)/assistant/actions";
import type { AssistantUIMessage } from "@/lib/ai/assistant/messages";
import { chatTransport } from "@/lib/ai/assistant/transport";
import {
  ANSWER_FAILED,
  type ChatMessage,
  type ChatUnit,
  type ConversationSummary,
  consultingText,
  LIVE_SUGGESTED_QUESTIONS,
  QUESTIONS_PER_MONTH,
} from "@/lib/assistant/chat";
import { textOf, toChatMessages } from "@/lib/assistant/messages-view";
import { settle } from "@/lib/server-action-call";

import { ChatLayout } from "./chat-layout";

// What the user reads when a question was refused: the server's own words; a
// page instead of words is a session that expired.
function refusalOf(error: Error): string {
  const message = error.message.trim();
  if (message.startsWith("<")) return "Tu sesión expiró. Volvé a entrar.";
  return message !== "" && message.length <= 120 ? message : ANSWER_FAILED;
}

// A stored message back as the chat holds it, its charts kept.
export const asUIMessage = (message: ChatMessage): AssistantUIMessage =>
  message.role === "user"
    ? {
        id: message.id,
        role: "user",
        parts: [{ type: "text", text: message.text }],
      }
    : {
        id: message.id,
        role: "assistant",
        parts: [{ type: "text", text: message.text }],
        metadata: {
          asOf: message.asOf,
          rate: message.rate,
          sources: message.sources,
          complete: true,
          charts: message.charts,
        },
      };

// The real assistant: each question streams its answer from the chat route,
// which reads the user's data and keeps the conversation.
export function AssistantChat({
  conversations,
  used,
  defaultUnit,
}: {
  conversations: ConversationSummary[];
  // The questions asked this month, deleted conversations' included.
  used: number;
  // The unit a new conversation starts in: the user's reference dollar.
  defaultUnit: ChatUnit;
}) {
  const router = useRouter();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [fresh, setFresh] = useState(() => crypto.randomUUID());
  const [unit, setUnit] = useState<ChatUnit>(defaultUnit);
  const [opening, setOpening] = useState(false);
  // Why the last question was not answered, and whether the user stopped it.
  const failure = useRef<Error | null>(null);
  const stopped = useRef(false);
  // The conversation being opened, so a slower earlier load is dropped.
  const loading = useRef<string | null>(null);
  const [transport] = useState(chatTransport);
  const { messages, sendMessage, setMessages, status, stop } =
    useChat<AssistantUIMessage>({
      transport,
      onError: (error) => {
        failure.current = error;
      },
      onFinish: ({ message }) => {
        // An answer the server finished carries its day and some text; one
        // it cut short or left empty was not kept.
        if (
          !stopped.current &&
          !failure.current &&
          (message.role !== "assistant" ||
            !message.metadata ||
            textOf(message.parts).trim() === "")
        ) {
          failure.current = new Error(ANSWER_FAILED);
        }
      },
    });

  const active = conversations.find((each) => each.id === activeId);
  const shown = useMemo(() => toChatMessages(messages), [messages]);
  const left = Math.max(0, QUESTIONS_PER_MONTH - used);
  const last = shown.at(-1);
  const busy = status === "submitted" || status === "streaming" || opening;
  const waiting =
    status === "submitted" ||
    (status === "streaming" && (last?.role !== "assistant" || last.text === ""))
      ? consultingText([])
      : null;

  function ask(question: string): Promise<unknown> | null {
    const text = question.trim();
    if (!text || busy || left === 0) return null;
    const conversationId = activeId ?? fresh;
    setActiveId(conversationId);
    failure.current = null;
    stopped.current = false;
    const asked = messages.length;
    return sendMessage(
      { text },
      { body: { conversationId, unit: active?.unit ?? unit } },
    ).then(() => {
      // The month's questions and the history come back from the server
      // either way.
      router.refresh();
      const error = failure.current;
      if (!error) return;
      // The question and whatever came of it were not kept: they leave the
      // conversation and the question comes back to the field.
      setMessages((current) => current.slice(0, asked));
      toast.error(refusalOf(error));
      throw error;
    });
  }

  async function open(conversationId: string | null) {
    stopped.current = true;
    void stop();
    loading.current = conversationId;
    if (conversationId === null) {
      setActiveId(null);
      setOpening(false);
      setFresh(crypto.randomUUID());
      setMessages([]);
      return;
    }
    setOpening(true);
    const loaded = await settle(loadConversation(conversationId));
    if (loading.current !== conversationId) return;
    setOpening(false);
    if (loaded === "rejected" || loaded === null) {
      // The conversation on screen stays the open one.
      toast.error("No pudimos abrir la conversación. Probá de nuevo.");
      return;
    }
    setActiveId(conversationId);
    setMessages(loaded.map(asUIMessage));
  }

  return (
    <ChatLayout
      conversations={conversations}
      active={active}
      onOpen={(id) => void open(id)}
      onDelete={(id) => {
        void settle(deleteConversation(id)).then((deleted) => {
          if (deleted !== true) {
            toast.error("No pudimos borrar la conversación. Probá de nuevo.");
            return;
          }
          toast.success("Borraste la conversación");
          if (id === activeId) void open(null);
          router.refresh();
        });
      }}
      messages={shown}
      arrivedId={null}
      waiting={waiting}
      announcement={
        status === "ready" && last?.role === "assistant" ? last.text : ""
      }
      suggestions={LIVE_SUGGESTED_QUESTIONS}
      questionsLeft={left}
      onAsk={ask}
      busy={busy}
      onStop={() => {
        stopped.current = true;
        void stop();
      }}
      unit={active?.unit ?? unit}
      unitLocked={active !== undefined || messages.length > 0}
      onUnit={setUnit}
    />
  );
}
