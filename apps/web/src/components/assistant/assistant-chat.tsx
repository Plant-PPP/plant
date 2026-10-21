"use client";

import { useChat } from "@ai-sdk/react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import {
  answerProposal,
  deleteConversation,
  loadConversation,
} from "@/app/(app)/(data)/assistant/actions";
import { isKeptPart } from "@/lib/assistant/proposals";
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

const STREAM_THROTTLE_MS = 50;

// A file as the chat sends it: its bytes in a data URL.
const asFilePart = (file: File) =>
  new Promise<{
    type: "file";
    mediaType: string;
    filename: string;
    url: string;
  }>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve({
        type: "file",
        mediaType: file.type,
        filename: file.name,
        url: String(reader.result),
      });
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

// A conversation as the history opens it, kept in the browser's cache so
// opening it again, or after hovering it, needs no wait.
const conversationQuery = (id: string) => ({
  queryKey: ["assistant", "conversation", id],
  queryFn: () => loadConversation(id),
});

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
        ...(message.attachments && {
          metadata: { attachments: message.attachments } as never,
        }),
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
          proposals: message.proposals ?? [],
          question: message.question ?? null,
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
  const queries = useQueryClient();
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
      // An answer streams a few words a chunk: one render per frame or so
      // reads the same.
      experimental_throttle: STREAM_THROTTLE_MS,
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
            (textOf(message.parts).trim() === "" &&
              !message.parts.some(isKeptPart)))
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

  function ask(question: string, files: File[] = []): Promise<unknown> | null {
    const text = question.trim();
    if ((!text && files.length === 0) || busy || left === 0) return null;
    const conversationId = activeId ?? fresh;
    setActiveId(conversationId);
    failure.current = null;
    stopped.current = false;
    const asked = messages.length;
    return Promise.all(files.map(asFilePart))
      .then((parts) =>
        sendMessage(parts.length > 0 ? { text, files: parts } : { text }, {
          body: { conversationId, unit: active?.unit ?? unit },
        }),
      )
      .then(() => {
        // The month's questions and the history come back from the server
        // either way; the conversation kept in the browser is behind.
        router.refresh();
        queries.removeQueries({
          queryKey: conversationQuery(conversationId).queryKey,
        });
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
    const loaded = await settle(
      queries.fetchQuery(conversationQuery(conversationId)),
    );
    if (loading.current !== conversationId) return;
    setOpening(false);
    if (loaded === "rejected" || loaded === null) {
      queries.removeQueries({
        queryKey: conversationQuery(conversationId).queryKey,
      });
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
      onPreview={(id) => void queries.prefetchQuery(conversationQuery(id))}
      onDelete={(id) => {
        void settle(deleteConversation(id)).then((deleted) => {
          if (deleted !== true) {
            toast.error("No pudimos borrar la conversación. Probá de nuevo.");
            return;
          }
          toast.success("Borraste la conversación");
          queries.removeQueries({ queryKey: conversationQuery(id).queryKey });
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
      onProposal={async (messageId, proposalId, decision) => {
        const answered = await settle(
          answerProposal({ messageId, proposalId, decision }),
        );
        if (answered === "rejected" || !answered.ok) {
          toast.error(
            answered !== "rejected" && answered.code === "refused"
              ? "No pudimos cargarlo: revisá los datos y probá desde su página."
              : "No pudimos guardar tu respuesta. Probá de nuevo.",
          );
          return false;
        }
        if (decision === "confirm" && answered.href) {
          toast.success("Revisalo y cargalo desde acá");
          router.push(answered.href);
          return true;
        }
        if (decision === "confirm") toast.success("Listo, quedó cargado");
        if (activeId) {
          queries.removeQueries({
            queryKey: conversationQuery(activeId).queryKey,
          });
        }
        router.refresh();
        return true;
      }}
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
