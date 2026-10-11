import { type Position, unrealized } from "@plant/core";
import { exactOf, over, sumOrNull, toDecimal } from "@plant/shared";

import { percentOf } from "@/lib/format/amount";

import type { HoldingsValuation } from "./valuation-view";

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

// The cost of one unit held, or null when there is none to price.
export function averageCost(position: Position): string | null {
  if (!position.money || exactOf(position.quantity).n === 0n) return null;
  return toDecimal(
    over(exactOf(position.money.cost), exactOf(position.quantity)),
    8,
  );
}

// The cost and gain of the shown holdings that have movements, each summed
// exactly: null when one of them cannot be expressed in the unit or has no
// value.
export function costTotals(
  rows: readonly { id: string }[],
  positions: ReadonlyMap<string, Position>,
  valuation: Pick<HoldingsValuation, "values">,
): { count: number; cost: string | null; gain: GainLoss | null } {
  const held = rows.flatMap((row) => {
    const position = positions.get(row.id);
    return position
      ? [{ money: position.money, value: valuation.values[row.id]?.value }]
      : [];
  });
  // No holding with movements has no cost to show, not a cost of 0.
  if (held.length === 0) return { count: 0, cost: null, gain: null };
  const cost = sumOrNull(
    held.map(({ money }) => money?.cost ?? null),
    8,
  );
  const value = sumOrNull(
    held.map(({ value }) => value ?? null),
    8,
  );
  return {
    count: held.length,
    cost,
    gain: cost === null || value === null ? null : gainOf(cost, value),
  };
}
