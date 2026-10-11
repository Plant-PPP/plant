"use client";

import { AssistantPage } from "@/components/assistant/assistant-page";

import { usePrototype } from "./prototype-provider";

// Asistente over the prototype's store, with made-up answers.
export function PrototypeChat() {
  const { state, actions } = usePrototype();
  return (
    <AssistantPage
      conversations={state.conversations}
      today={state.today}
      actions={actions.assistant}
    />
  );
}
