import { quantityOn } from "@plant/core";
import {
  type Exact,
  exactOf,
  plus,
  stored,
  toDecimal,
  ZERO,
} from "@plant/shared";

import { closesOf } from "@/lib/summary/compute";
import { CLOSE_UNITS, type MonthClose } from "@/lib/summary/closes";

import { groupKey, type PrototypeState } from "./prototype-store";

// What a write to a month or an earlier one changes in its close. A write
// moves no quote, so every value that moved, moved because of it: the
// month's figures to the cent (so how a figure splits across portfolios does
// not show), plus its own movements and the units held at its end, per
// account and instrument so moving a holding to another portfolio changes
// nothing.
function movedBy(state: PrototypeState, close: MonthClose): string {
  const own = new Map<string, Exact[]>();
  const held = new Map<string, Exact>();
  for (const each of state.holdings) {
    if (each.holding.asset_class !== "instrument") continue;
    const at = groupKey(each);
    const movements = state.movements.get(each.holding.id) ?? [];
    const quantity = exactOf(quantityOn(movements, close.to));
    if (quantity.n !== 0n) {
      held.set(at, plus(held.get(at) ?? ZERO, quantity));
    }
    for (const movement of movements) {
      if (movement.date <= close.from || movement.date > close.to) continue;
      const key = JSON.stringify([
        at,
        movement.operation_id,
        movement.kind,
        movement.date,
        movement.currency,
        "price" in movement ? movement.price : null,
        "direction" in movement ? movement.direction : null,
      ]);
      const [size = ZERO, charges = ZERO] = own.get(key) ?? [];
      own.set(key, [
        plus(
          size,
          exactOf("quantity" in movement ? movement.quantity : movement.amount),
        ),
        plus(charges, ...movement.charges.map(({ amount }) => exactOf(amount))),
      ]);
    }
  }
  const cents = (value: string | null) =>
    value === null ? null : toDecimal(exactOf(value), 2);
  const { figures } = close;
  return JSON.stringify([
    [...own]
      .map(([key, [size, charges]]) => [key, stored(size!), stored(charges!)])
      .sort(),
    [...held].map(([key, units]) => [key, stored(units)]).sort(),
    [
      figures.startValue,
      figures.endValue,
      figures.paidIn,
      figures.proceeds,
      figures.income,
      figures.charges,
      close.realized,
    ].map(cents),
  ]);
}

// The closed months whose figures or own movements a write changed, in any
// unit closes are shown in (a dollar movement's date moves its pesos, not its
// dollars), marked as recalculated today; the month in progress is never
// marked.
export function markRecalculated(
  before: PrototypeState,
  after: PrototypeState,
): PrototypeState {
  if (before.movements === after.movements) return after;
  const changed = new Set<string>();
  for (const unit of CLOSE_UNITS) {
    const was = new Map(
      closesOf(before, unit).map((each) => [
        each.period,
        movedBy(before, each),
      ]),
    );
    for (const each of closesOf(after, unit)) {
      if (
        !each.open &&
        was.has(each.period) &&
        was.get(each.period) !== movedBy(after, each)
      ) {
        changed.add(each.period);
      }
    }
  }
  if (changed.size === 0) return after;
  const recalculated = new Map(after.recalculated);
  for (const period of changed) recalculated.set(period, after.today);
  return { ...after, recalculated };
}
