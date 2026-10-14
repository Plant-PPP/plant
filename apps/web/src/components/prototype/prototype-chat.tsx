"use client";

import { referenceUnit } from "@plant/core";

import { AssistantPage } from "@/components/assistant/assistant-page";
import { PinContext } from "@/components/assistant/pin-context";
import { usedThisMonth } from "@/lib/format/text";

import { usePrototype } from "./prototype-provider";

// Asistente over the prototype's store, with made-up answers.
export function PrototypeChat() {
  const { state, actions } = usePrototype();
  return (
    <PinContext.Provider value={{ pin: actions.pins.pin, pins: () => true }}>
      <AssistantPage
        conversations={state.conversations}
        used={usedThisMonth(state.askedOn, state.today)}
        defaultUnit={referenceUnit(state.referenceDollar)}
        actions={actions.assistant}
      />
    </PinContext.Provider>
  );
}
