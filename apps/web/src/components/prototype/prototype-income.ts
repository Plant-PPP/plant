import {
  compareMovements,
  express,
  type Movement,
  placementFigures,
  type QuoteSnapshot,
  upcomingIncome,
} from "@plant/core";
import { addDays, exactOf, stored } from "@plant/shared";

import type { ChatUnit } from "@/lib/assistant/chat";
import { holdingName, instrumentNames } from "@/lib/holdings/holding-name";

import type { PrototypeState } from "./prototype-store";

// How far ahead the calendar looks.
export const CALENDAR_DAYS = 90;

export type IncomeEvent = {
  date: string;
  kind: "dividend" | "coupon" | "maturity";
  name: string;
  // In the unit at today's rates; null when a rate is missing.
  value: string | null;
};

// What the user is expected to collect from tomorrow to `CALENDAR_DAYS`
// ahead, by date: each instrument's dividends and coupons from what it paid
// before, across every account it is held in, and each placement that
// matures, with its capital and interest.
export function incomeCalendar(
  state: PrototypeState,
  snapshot: QuoteSnapshot,
  unit: ChatUnit,
): IncomeEvent[] {
  const names = instrumentNames(state.instruments);
  const until = addDays(state.today, CALENDAR_DAYS);
  const inUnit = (amount: string, currency: "ARS" | "USD") => {
    const shown = express(
      { amount: exactOf(amount), currency },
      state.today,
      unit,
      snapshot,
      state.referenceDollar,
    );
    return "missing" in shown ? null : stored(shown.value.amount);
  };
  const open = state.holdings.filter((each) => !each.closed);
  const bySymbol = new Map<string, Movement[]>();
  for (const { holding } of open) {
    if (holding.asset_class !== "instrument") continue;
    const symbol = holding.instrument_symbol;
    bySymbol.set(symbol, [
      ...(bySymbol.get(symbol) ?? []),
      ...(state.movements.get(holding.id) ?? []),
    ]);
  }
  const events: IncomeEvent[] = [];
  for (const [symbol, movements] of bySymbol) {
    const sorted = [...movements].sort(compareMovements);
    for (const each of upcomingIncome(sorted, state.today, CALENDAR_DAYS)) {
      events.push({
        date: each.date,
        kind: each.kind,
        name: names.get(symbol) ?? symbol,
        value: inUnit(each.amount, each.currency),
      });
    }
  }
  for (const { holding } of open) {
    if (holding.asset_class !== "fixed_term") continue;
    if (holding.matures_on <= state.today || holding.matures_on > until) {
      continue;
    }
    events.push({
      date: holding.matures_on,
      kind: "maturity",
      name: holdingName(holding, names),
      value: inUnit(
        placementFigures(holding, state.today).maturityAmount,
        holding.currency,
      ),
    });
  }
  return events.sort((a, b) => a.date.localeCompare(b.date));
}
