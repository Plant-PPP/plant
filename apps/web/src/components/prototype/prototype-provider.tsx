"use client";

import type { ManualRateKind, QuoteSnapshot } from "@plant/core";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
} from "react";

import {
  alertQuote,
  type AlertWriteResult,
  MAX_ALERTS,
  meets,
  type NewAlert,
  type PriceAlert,
} from "@/lib/alerts/alerts";
import { withGainFigures } from "@/lib/alerts/gain";
import type {
  AssistantActions,
  ChartPart,
  PinResult,
} from "@/lib/assistant/chat";
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
import { CONSENT_VERSION } from "@/lib/consent";
import { buildFixtures } from "@/lib/prototype/fixtures";

import {
  acceptConsent,
  allRows,
  createHolding,
  deleteHolding,
  deleteOperation,
  deletePrice,
  deleteRate,
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
  setRate,
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
  fed: ReadonlySet<string>;
  // The date of each dollar rate the user stated that the snapshot took.
  manualRates: ReadonlyMap<ManualRateKind, string>;
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
    pins: {
      pin: (chart: ChartPart) => Promise<PinResult>;
      unpin: (id: string) => Promise<boolean>;
    };
    alerts: {
      create: (alert: NewAlert) => Promise<AlertWriteResult>;
      delete: (id: string) => Promise<boolean>;
      seen: (id: string) => Promise<boolean>;
    };
    preferences: { set: (next: Preferences) => Promise<{ ok: boolean }> };
    rates: {
      set: (rate: {
        kind: ManualRateKind;
        sell: string;
        date: string;
      }) => Promise<{ ok: boolean }>;
      revert: (kind: ManualRateKind, date: string) => Promise<{ ok: boolean }>;
    };
    // A property's sheet.
    realEstate: (id: string, sheet: RealEstateSheet) => Promise<WriteResult>;
    // Accepts the terms in force.
    acceptConsent: () => void;
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
    rates: {
      set: ({ kind, sell, date }) =>
        write((s) => setRate(s, { kind, sell, rate_date: date })),
      revert: (kind, date) => write((s) => deleteRate(s, kind, date)),
    },
    realEstate: (id, sheet) => write((s) => setRealEstateSheet(s, id, sheet)),
    acceptConsent: () =>
      void writeState((s) => acceptConsent(s, CONSENT_VERSION)),
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
      // The sources the answer will name, as the model's tool calls would.
      consults: (question, unit) =>
        assistant.prototypeAnswer(
          latest.current,
          question,
          unit,
          pricedSnapshotOf(latest.current, snapshot).snapshot,
        ).sources,
    },
    alerts: {
      create: (alert) =>
        write((s) => {
          if (s.priceAlerts.length >= MAX_ALERTS) {
            return { state: s, result: "full" as const };
          }
          let added: PriceAlert;
          if (alert.subjectKind === "gain") {
            const instrument = s.instruments.find(
              (each) => each.symbol === alert.subject,
            );
            if (!instrument) {
              return { state: s, result: "unknown_instrument" as const };
            }
            [added] = withGainFigures(s, [
              {
                id: crypto.randomUUID(),
                subjectKind: "instrument",
                subject: alert.subject,
                direction: alert.direction,
                threshold: null,
                currency: instrument.currency,
                gainPercent: alert.percent,
                costPrice: null,
                metOn: null,
                metPrice: null,
                seenAt: null,
              },
            ]) as [PriceAlert];
          } else {
            added = {
              ...alert,
              id: crypto.randomUUID(),
              gainPercent: null,
              costPrice: null,
              metOn: null,
              metPrice: null,
              seenAt: null,
            };
          }
          const quote = alertQuote(
            added,
            pricedSnapshotOf(s, snapshot).snapshot,
          );
          const met = quote !== null && meets(added, quote.price);
          return {
            state: {
              ...s,
              priceAlerts: [
                {
                  ...added,
                  metOn: met ? quote.date : null,
                  metPrice: met ? quote.price : null,
                },
                ...s.priceAlerts,
              ],
            },
            result: "ok" as const,
          };
        }),
      delete: (id) =>
        write((s) => ({
          state: {
            ...s,
            priceAlerts: s.priceAlerts.filter((each) => each.id !== id),
          },
          result: true,
        })),
      seen: (id) =>
        write((s) => ({
          state: {
            ...s,
            priceAlerts: s.priceAlerts.map((each) =>
              each.id === id && each.metOn !== null
                ? { ...each, seenAt: new Date().toISOString() }
                : each,
            ),
          },
          result: true,
        })),
    },
    pins: {
      // A chart is pinned once: by which chart it is when it says, as the
      // real app does, or else by what it shows.
      pin: (chart) =>
        write((s) => {
          const key = (each: ChartPart) => JSON.stringify(each.source ?? each);
          if (s.pinnedCharts.some((each) => key(each.chart) === key(chart))) {
            return { state: s, result: "already" as const };
          }
          if (s.pinnedCharts.length >= 12) {
            return { state: s, result: "full" as const };
          }
          return {
            state: {
              ...s,
              pinnedCharts: [
                ...s.pinnedCharts,
                { id: crypto.randomUUID(), chart },
              ],
            },
            result: "pinned" as const,
          };
        }),
      unpin: (id) =>
        write((s) => ({
          state: {
            ...s,
            pinnedCharts: s.pinnedCharts.filter((each) => each.id !== id),
          },
          result: s.pinnedCharts.some((each) => each.id === id),
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
  const fed = new Set(Object.keys(snapshot.prices));
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
        manualRates: priced.rates,
        details,
        actions,
      }}
    >
      {children}
    </PrototypeContext>
  );
}
