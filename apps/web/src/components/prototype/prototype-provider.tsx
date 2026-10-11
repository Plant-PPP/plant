"use client";

import type { QuoteSnapshot } from "@plant/core";
import { createContext, type ReactNode, useContext } from "react";

import type {
  HoldingActions,
  MovementActions,
} from "@/components/holdings/assets-setup";
import { buildFixtures } from "@/lib/prototype/fixtures";

import {
  createHolding,
  initialState,
  type PrototypeState,
  updateHolding,
  writeOperation,
} from "./prototype-store";
import { usePrototypeStore } from "./use-prototype-store";

type Prototype = {
  state: PrototypeState;
  // The state as of the last write, for reads that run between renders.
  latest: () => PrototypeState;
  snapshot: QuoteSnapshot;
  actions: { holdings: HoldingActions; movements: MovementActions };
};

const PrototypeContext = createContext<Prototype | null>(null);

export function usePrototype(): Prototype {
  const prototype = useContext(PrototypeContext);
  if (!prototype) throw new Error("usePrototype outside PrototypeProvider");
  return prototype;
}

// One store for every prototype page, so a change shows on all of them until
// the page reloads.
export function PrototypeProvider({
  today,
  snapshot,
  children,
}: {
  today: string;
  snapshot: QuoteSnapshot;
  children: ReactNode;
}) {
  const { state, latest, write } = usePrototypeStore(() =>
    initialState(buildFixtures(today), today),
  );
  const actions: Prototype["actions"] = {
    holdings: {
      create: (input) =>
        write((s) => createHolding(s, input, crypto.randomUUID())),
      update: (id, input) => write((s) => updateHolding(s, id, input)),
    },
    movements: {
      create: (input) =>
        write((s) =>
          writeOperation(s, input, {
            operationId: crypto.randomUUID(),
            newId: () => crypto.randomUUID(),
          }),
        ),
      update: (operationId, input) =>
        write((s) =>
          writeOperation(s, input, {
            operationId,
            replacing: true,
            newId: () => crypto.randomUUID(),
          }),
        ),
    },
  };
  return (
    <PrototypeContext
      value={{ state, latest: () => latest.current, snapshot, actions }}
    >
      {children}
    </PrototypeContext>
  );
}
