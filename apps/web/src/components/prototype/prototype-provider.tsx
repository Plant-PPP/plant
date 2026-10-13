"use client";

import type { QuoteSnapshot } from "@plant/core";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
} from "react";

import type { AssistantActions } from "@/components/assistant/assistant-page";
import type { HoldingDetails } from "@/components/holdings/assets-setup";
import type { DebtActions } from "@/components/debts/debts-setup";
import type { ImportActions } from "@/components/imports/import-page";
import type { ReviewActions } from "@/components/imports/import-review";
import type { Preferences } from "@/components/settings/preferences-card";
import type { RealEstateSheet } from "@/lib/real-estate/sheet";
import type { WriteResult } from "@/lib/portfolio-setup/write-result";
import type { PortfolioActions } from "@/components/portfolio-setup/portfolios-card";
import type { SourceConnectionActions } from "@/components/portfolio-setup/source-connections-card";
import type {
  HoldingActions,
  MovementActions,
  PriceActions,
} from "@/lib/holdings/write-actions";
import { buildFixtures } from "@/lib/prototype/fixtures";

import {
  allRows,
  createHolding,
  deleteHolding,
  deleteOperation,
  deletePrice,
  freshState,
  initialState,
  pricedSnapshotOf,
  renewPlacement,
  type PrototypeState,
  setInTaxReport,
  setPlacement,
  setPreferences,
  setRealEstateSheet,
  setPrice,
  type Write,
  updateHolding,
  updateHoldingDetails,
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
  details: HoldingDetails;
  actions: {
    holdings: HoldingActions;
    movements: MovementActions;
    prices: PriceActions;
    sourceConnections: SourceConnectionActions;
    portfolios: PortfolioActions;
    debts: DebtActions;
    imports: ImportActions & ReviewActions;
    assistant: AssistantActions;
    preferences: { set: (next: Preferences) => Promise<{ ok: boolean }> };
    // A property's sheet.
    realEstate: (id: string, sheet: RealEstateSheet) => Promise<WriteResult>;
    // Leaves the store as a new user's.
    deleteAccount: () => void;
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
  // The simulated reading's timers, cleared when the pages go away.
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending) clearTimeout(timer);
      pending.clear();
    };
  }, []);
  const later = (run: () => void, ms: number) => {
    const timer = setTimeout(() => {
      timers.current.delete(timer);
      run();
    }, ms);
    timers.current.add(timer);
  };
  // Every write marks the closed months it changed as recalculated.
  const write = <R,>(change: (state: PrototypeState) => Write<R>) =>
    writeState((before) => {
      const next = change(before);
      return next.state === before
        ? next
        : {
            ...next,
            state: markRecalculated(before, next.state),
          };
    });
  const actions: Prototype["actions"] = {
    // A preference changes how the pages show the data, not the data, so no
    // close is marked recalculated.
    preferences: {
      set: (next) => writeState((s) => setPreferences(s, next)),
    },
    realEstate: (id, sheet) => write((s) => setRealEstateSheet(s, id, sheet)),
    deleteAccount: () =>
      void writeState((s) => ({
        state: freshState(s, crypto.randomUUID()),
        result: null,
      })),
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
          later(() => {
            void write((s) => ({
              state: assistant.addAnswer(s, conversationId, {
                id,
                ...assistant.prototypeAnswer(
                  s,
                  question,
                  unit,
                  pricedSnapshotOf(s, snapshot).snapshot,
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
          later(
            () =>
              void write((s) => ({
                state: imports.startReading(s, id),
                result: null,
              })),
            700 + index * 500,
          );
          later(
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
  const details: HoldingDetails = {
    originOf: (id) =>
      state.holdings.find((each) => each.holding.id === id)?.origin,
    inTaxReport: (key) => !state.outOfTaxReport.has(key),
    placementOf: (id) => state.placements.get(id) ?? "fixed_term",
    renewalOf: (id) => {
      const renewed = state.renewals.get(id);
      return renewed === undefined
        ? undefined
        : allRows(state).find((row) => row.id === renewed);
    },
    actions: {
      setInTaxReport: (key, on) => write((s) => setInTaxReport(s, key, on)),
      update: (id, input, choices) =>
        write((s) => updateHoldingDetails(s, id, input, choices)),
      setPlacement: (id, kind) => write((s) => setPlacement(s, id, kind)),
      renew: (id, input) =>
        write((s) => renewPlacement(s, id, input, crypto.randomUUID())),
    },
  };
  const priced = pricedSnapshotOf(state, snapshot);
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
        details,
        actions,
      }}
    >
      {children}
    </PrototypeContext>
  );
}
