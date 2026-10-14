import {
  compareMovements,
  express,
  type IncomePattern,
  incomePattern,
  type Movement,
  placementFigures,
  quantityOn,
  type QuoteSnapshot,
  upcomingFrom,
} from "@plant/core";
import {
  addDays,
  type Exact,
  exactOf,
  plus,
  stored,
  ZERO,
} from "@plant/shared";

import { holdingName, instrumentNames } from "@/lib/holdings/holding-name";
import { groupOf, type Ledger } from "@/lib/ledger/ledger";

import type { ChatUnit } from "./chat";

// How far ahead the calendar looks.
export const CALENDAR_DAYS = 90;

const latestPattern = (patterns: readonly (IncomePattern | null)[]) =>
  patterns.reduce<IncomePattern | null>(
    (best, each) => (each && (!best || each.last > best.last) ? each : best),
    null,
  );

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
  state: Ledger,
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
  const sortedOf = (id: string) =>
    [...(state.movements.get(id) ?? [])].sort(compareMovements);
  // Each holding is projected from its own payments, as every account pays
  // on its own day, then one instrument's payments on a day are summed. A
  // holding with no pattern of its own, as one whose units came from another
  // account, takes the latest pattern another holding of its instrument has.
  const paid = new Map<
    string,
    { date: string; kind: IncomeEvent["kind"]; symbol: string } & Pick<
      Movement,
      "currency"
    > & { amount: Exact }
  >();
  for (const { holding } of open) {
    if (holding.asset_class !== "instrument") continue;
    const symbol = holding.instrument_symbol;
    const sorted = sortedOf(holding.id);
    const pattern =
      incomePattern(sorted, state.today) ??
      latestPattern(
        groupOf(state, holding.id)
          .filter((id) => id !== holding.id)
          .map((id) => incomePattern(sortedOf(id), state.today)),
      );
    const held = quantityOn(sorted, state.today);
    for (const each of upcomingFrom(
      pattern,
      held,
      state.today,
      CALENDAR_DAYS,
    )) {
      const key = `${symbol}|${each.date}|${each.kind}|${each.currency}`;
      const kept = paid.get(key);
      paid.set(key, {
        date: each.date,
        kind: each.kind,
        symbol,
        currency: each.currency,
        amount: plus(kept?.amount ?? ZERO, exactOf(each.amount)),
      });
    }
  }
  const events: IncomeEvent[] = [...paid.values()].map((each) => ({
    date: each.date,
    kind: each.kind,
    name: names.get(each.symbol) ?? each.symbol,
    value: inUnit(stored(each.amount), each.currency),
  }));
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
