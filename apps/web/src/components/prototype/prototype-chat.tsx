"use client";

import { type Denominator, referenceUnit } from "@plant/core";

import { AssistantPage } from "@/components/assistant/assistant-page";
import { CHAT_UNITS, type ChatUnit } from "@/lib/assistant/chat";

import { usePrototype } from "./prototype-provider";

// The user's reference unit when the assistant answers in it, else MEP.
const chatUnitOf = (unit: Denominator): ChatUnit =>
  (CHAT_UNITS as readonly Denominator[]).includes(unit)
    ? (unit as ChatUnit)
    : "usd_mep";

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
      defaultUnit={chatUnitOf(referenceUnit(state.referenceDollar))}
      actions={actions.assistant}
    />
  );
}
