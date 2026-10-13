import { type Position, unrealized } from "@plant/core";
import { exactOf, over, stored, sumOrNull } from "@plant/shared";

import { percentOf } from "@/lib/format/amount";

import type { Sum } from "./valuation-view";

// What units would gain or lose at their value: the amount, and that as a
// percent of cost to one decimal (null when cost is 0).
export type GainLoss = { amount: string; percent: string | null };

export function gainOf(cost: string, value: string): GainLoss {
  const { amount, share } = unrealized(cost, value);
  return { amount, percent: share === null ? null : percentOf(share) };
}

// A holding's gain at its value, or null when its cost or value is unknown in
// the unit.
export const gainLoss = (
  position: Position,
  value: string | null,
): GainLoss | null =>
  position.money && value !== null ? gainOf(position.money.cost, value) : null;

// A cost over its units, or null for no units.
export function averageOf(cost: string, quantity: string): string | null {
  if (exactOf(quantity).n === 0n) return null;
  return stored(over(exactOf(cost), exactOf(quantity)));
}

export type CostTotals = {
  count: number;
  cost: string | null;
  gain: GainLoss | null;
  // Their units, which only add up within one instrument.
  quantity: string | null;
};

// The cost, gain and units of the holdings that have movements, each summed
// exactly: cost and gain null when one of them cannot be expressed in the
// unit or has no value.
export function costTotals(
  items: readonly {
    position: Position | null | undefined;
    value: string | null | undefined;
  }[],
): CostTotals {
  const held = items.flatMap(({ position, value }) =>
    position ? [{ position, value: value ?? null }] : [],
  );
  // No holding with movements has no cost to show, not a cost of 0.
  if (held.length === 0) {
    return { count: 0, cost: null, gain: null, quantity: null };
  }
  const cost = sumOrNull(
    held.map(({ position }) => position.money?.cost ?? null),
  );
  const value = sumOrNull(held.map(({ value }) => value));
  return {
    count: held.length,
    cost,
    gain: cost === null || value === null ? null : gainOf(cost, value),
    quantity: sumOrNull(held.map(({ position }) => position.quantity)),
  };
}

// Totals whose gain is over an exact sum rounded once, when every holding the
// sum covers has movements and a quote: costTotals adds each holding's value
// rounded alone, which can miss the shown sum by a cent.
export function overExactSum(
  totals: CostTotals,
  sum: Pick<Sum, "value" | "count" | "missing"> | null | undefined,
): CostTotals {
  return sum &&
    totals.count === sum.count &&
    totals.cost !== null &&
    sum.missing === 0
    ? { ...totals, gain: gainOf(totals.cost, sum.value) }
    : totals;
}
