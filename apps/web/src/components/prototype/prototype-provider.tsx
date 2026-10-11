"use client";

import {
  type QuoteSnapshot,
  referenceUnit,
  withManualPrices,
} from "@plant/core";
import { createContext, type ReactNode, useContext } from "react";

import type {
  HoldingActions,
  MovementActions,
  PriceActions,
} from "@/components/holdings/assets-setup";
import type { AssistantActions } from "@/components/assistant/assistant-page";
import type { DebtActions } from "@/components/debts/debts-setup";
import type { ImportActions } from "@/components/imports/import-page";
import type { ReviewActions } from "@/components/imports/import-review";
import type { NamedRowsActions } from "@/components/portfolio-setup/named-rows-card";
import type { SourceConnectionActions } from "@/components/portfolio-setup/source-connections-card";
import { buildFixtures } from "@/lib/prototype/fixtures";

import {
  createHolding,
  deleteHolding,
  deleteOperation,
  deletePrice,
  initialState,
  type PrototypeState,
  setPrice,
  type Write,
  updateHolding,
  writeOperation,
} from "./prototype-store";
import * as accounts from "./prototype-accounts-store";
import * as debts from "./prototype-debts-store";
import * as imports from "./prototype-imports-store";
import * as assistant from "./prototype-assistant";
import { markRecalculated } from "./prototype-closes";
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
    sourceConnections: SourceConnectionActions;
    portfolios: NamedRowsActions;
    debts: DebtActions;
    imports: ImportActions & ReviewActions;
    assistant: AssistantActions;
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
  const {
    state,
    latest,
    write: writeState,
  } = usePrototypeStore(() => initialState(buildFixtures(today), today));
  // Every write marks the closed months it changed as recalculated.
  const write = <R,>(change: (state: PrototypeState) => Write<R>) =>
    writeState((before) => {
      const next = change(before);
      return next.state === before
        ? next
        : {
            ...next,
            state: markRecalculated(
              before,
              next.state,
              referenceUnit(before.referenceDollar),
            ),
          };
    });
  const actions: Prototype["actions"] = {
    holdings: {
      create: (input) =>
        write((s) => createHolding(s, input, crypto.randomUUID())),
      update: (id, input) => write((s) => updateHolding(s, id, input)),
      delete: (id) => write((s) => deleteHolding(s, id)),
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
      delete: (operationId) => write((s) => deleteOperation(s, operationId)),
    },
    prices: {
      set: (input) => write((s) => setPrice(s, input)),
      delete: (symbol, date) => write((s) => deletePrice(s, symbol, date)),
    },
    sourceConnections: {
      create: (input) =>
        write((s) => accounts.createAccount(s, input, crypto.randomUUID())),
      update: (id, input) => write((s) => accounts.updateAccount(s, id, input)),
      archive: (id) => write((s) => accounts.archiveAccount(s, id)),
      restore: (id, input) =>
        write((s) => accounts.restoreAccount(s, id, input)),
      delete: (id) => write((s) => accounts.deleteAccount(s, id)),
    },
    assistant: {
      // The question shows at once and the answer a moment later, as the
      // model's would after reading its tools.
      ask: (conversationId, question, unit) =>
        new Promise((resolve) => {
          const id = crypto.randomUUID();
          void write((s) => ({
            state: assistant.addQuestion(s, {
              conversationId,
              id: crypto.randomUUID(),
              question,
              unit,
            }),
            result: null,
          }));
          setTimeout(() => {
            void write((s) => ({
              state: assistant.addAnswer(s, conversationId, {
                id,
                ...assistant.prototypeAnswer(
                  s,
                  question,
                  unit,
                  withManualPrices(snapshot, s.manualPrices).snapshot,
                ),
              }),
              result: null,
            })).then(() => resolve(id));
          }, 1100);
        }),
      delete: (conversationId) =>
        void write((s) => ({
          state: assistant.deleteConversation(s, conversationId),
          result: null,
        })),
    },
    imports: {
      // Each file is queued, read a moment later and ready after that, as
      // the real job's status would arrive.
      upload: (files, accountId) => {
        files.forEach((file, index) => {
          const id = crypto.randomUUID();
          void write((s) =>
            imports.addImport(s, { id, fileName: file.name, accountId }),
          );
          setTimeout(
            () =>
              void write((s) => ({
                state: imports.startReading(s, id),
                result: null,
              })),
            700 + index * 500,
          );
          setTimeout(
            () =>
              void write((s) => ({
                state: imports.finishReading(s, id),
                result: null,
              })),
            2400 + index * 900,
          );
        });
      },
      confirm: (id, rows) =>
        write((s) =>
          imports.confirmImport(s, id, rows, () => crypto.randomUUID()),
        ),
    },
    debts: {
      create: (input) =>
        write((s) => debts.createLiability(s, input, crypto.randomUUID())),
      update: (id, input) => write((s) => debts.updateLiability(s, id, input)),
      delete: (id) => write((s) => debts.deleteLiability(s, id)),
    },
    portfolios: {
      create: (input) =>
        write((s) => accounts.createPortfolio(s, input, crypto.randomUUID())),
      rename: (id, input) =>
        write((s) => accounts.renamePortfolio(s, id, input)),
      archive: (id) => write((s) => accounts.archivePortfolio(s, id)),
      restore: (id, input) =>
        write((s) => accounts.restorePortfolio(s, id, input)),
      delete: (id) => write((s) => accounts.deletePortfolio(s, id)),
    },
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
