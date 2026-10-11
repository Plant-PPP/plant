"use client";

import { referenceUnit } from "@plant/core";

import { AssistantPage } from "@/components/assistant/assistant-page";

import { usePrototype } from "./prototype-provider";

// Asistente over the prototype's store, with made-up answers.
export function PrototypeChat() {
  const { state, actions } = usePrototype();
  return (
    <AssistantPage
      conversations={state.conversations}
      used={
        state.askedOn.filter(
          (day) => day.slice(0, 7) === state.today.slice(0, 7),
        ).length
      }
      defaultUnit={referenceUnit(state.referenceDollar)}
      actions={actions.assistant}
    />
  );
}
