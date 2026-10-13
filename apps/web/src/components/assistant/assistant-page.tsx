"use client";

import { useState } from "react";
import { toast } from "sonner";

import {
  ANSWER_FAILED,
  type AssistantActions,
  type ChatUnit,
  type Conversation,
  consultingText,
  QUESTIONS_PER_MONTH,
  SUGGESTED_QUESTIONS,
  summaryOf,
} from "@/lib/assistant/chat";

import { ChatLayout } from "./chat-layout";

// The prototype's assistant: a conversation about the user's own data, in one
// unit, asked through the prototype's actions, waiting for each answer whole.
export function AssistantPage({
  conversations,
  used,
  defaultUnit,
  actions,
}: {
  conversations: Conversation[];
  // The unit a new conversation starts in: the user's reference dollar.
  defaultUnit: ChatUnit;
  // The questions asked this month.
  used: number;
  actions: AssistantActions;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [fresh, setFresh] = useState(() => crypto.randomUUID());
  const [unit, setUnit] = useState<ChatUnit>(defaultUnit);
  // What is being consulted while a question waits, or null.
  const [waiting, setWaiting] = useState<string | null>(null);
  // The answer that just arrived, which reveals itself and is announced once;
  // opening another conversation lets it go.
  const [arrived, setArrived] = useState<string | null>(null);

  const conversation = conversations.find((each) => each.id === activeId);
  const messages = conversation?.messages ?? [];
  const lastAnswer = messages.find((message) => message.id === arrived);
  const left = Math.max(0, QUESTIONS_PER_MONTH - used);

  function ask(question: string): Promise<unknown> | null {
    const text = question.trim();
    if (!text || waiting !== null || left === 0) return null;
    const conversationId = conversation?.id ?? fresh;
    setActiveId(conversationId);
    setArrived(null);
    const asked = conversation?.unit ?? unit;
    setWaiting(consultingText(actions.consults?.(text, asked) ?? []));
    return actions
      .ask(conversationId, text, asked)
      .then(
        (answerId) => setArrived(answerId),
        (error: unknown) => {
          toast.error(ANSWER_FAILED);
          throw error;
        },
      )
      .finally(() => setWaiting(null));
  }

  function open(conversationId: string | null) {
    setActiveId(conversationId);
    setArrived(null);
    if (conversationId === null) setFresh(crypto.randomUUID());
  }

  return (
    <ChatLayout
      conversations={conversations.map(summaryOf)}
      active={conversation && summaryOf(conversation)}
      onOpen={open}
      onDelete={(id) => {
        if (id === activeId) open(null);
        actions.delete(id);
        toast.success("Borraste la conversación");
      }}
      messages={messages}
      arrivedId={arrived}
      waiting={waiting}
      announcement={lastAnswer?.role === "assistant" ? lastAnswer.text : ""}
      suggestions={SUGGESTED_QUESTIONS}
      questionsLeft={left}
      onAsk={ask}
      busy={waiting !== null}
      unit={conversation?.unit ?? unit}
      unitLocked={conversation !== undefined}
      onUnit={setUnit}
    />
  );
}
