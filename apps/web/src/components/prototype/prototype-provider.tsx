"use client";

import { type QuoteSnapshot, withManualPrices } from "@plant/core";
import { createContext, type ReactNode, useContext } from "react";

import type {
  HoldingActions,
  MovementActions,
  PriceActions,
} from "@/components/holdings/assets-setup";
import { buildFixtures } from "@/lib/prototype/fixtures";

import {
  createHolding,
  initialState,
  type PrototypeState,
  setPrice,
  updateHolding,
  writeOperation,
} from "./prototype-store";
import { usePrototypeStore } from "./use-prototype-store";

type Prototype = {
  state: PrototypeState;
  // The state as of the last write, for reads that run between renders.
  latest: () => PrototypeState;
  // Today's quotes with the user's manual prices, and the date of each
  // manual price they took.
  snapshot: QuoteSnapshot;
  manual: ReadonlyMap<string, { price: string; date: string }>;
  fed: (symbol: string) => boolean;
  actions: {
    holdings: HoldingActions;
    movements: MovementActions;
    prices: PriceActions;
  };
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
    prices: { set: (input) => write((s) => setPrice(s, input)) },
  };
  const priced = withManualPrices(snapshot, state.manualPrices);
  // Whether the feeds priced a symbol today, before any manual price.
  const fed = (symbol: string) => snapshot.prices[symbol] !== undefined;
  return (
    <PrototypeContext
      value={{
        state,
        latest: () => latest.current,
        snapshot: priced.snapshot,
        manual: new Map(
          [...priced.manual].map(([symbol, date]) => [
            symbol,
            { price: priced.snapshot.prices[symbol]!.price, date },
          ]),
        ),
        fed,
        actions,
      }}
    >
      {children}
    </PrototypeContext>
  );
}
