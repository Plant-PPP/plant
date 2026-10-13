"use client";

import { referenceUnit } from "@plant/core";

import { AssistantPage } from "@/components/assistant/assistant-page";
import { usedThisMonth } from "@/lib/format/text";

import { usePrototype } from "./prototype-provider";

// Asistente over the prototype's store, with made-up answers.
export function PrototypeChat({
  suggestions,
  compact,
}: {
  suggestions?: readonly string[];
  compact?: boolean;
}) {
  const { state, actions } = usePrototype();
  return (
    <AssistantPage
      conversations={state.conversations}
      used={usedThisMonth(state.askedOn, state.today)}
      defaultUnit={referenceUnit(state.referenceDollar)}
      actions={actions.assistant}
      suggestions={suggestions}
      compact={compact}
    />
  );
}
