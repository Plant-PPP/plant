import { compareExact, exactOf, plus, stored, ZERO } from "@plant/shared";
import { UNIT_FX_KINDS, type ValuedFxKind } from "../valuation/denominators";
import {
  type Movement,
  type MovementRates,
  startsHolding,
  unitsMoved,
} from "./movement";
import { compareMovements } from "./order";

export type MovementRefusal =
  "oversold" | "opening_balance" | "future_date" | "no_rate";

// The refusals that another place within the day can change.
const ORDER_REFUSALS = [
  "oversold",
  "opening_balance",
] as const satisfies readonly MovementRefusal[];

export const isOrderRefusal = (
  code: string,
): code is (typeof ORDER_REFUSALS)[number] =>
  (ORDER_REFUSALS as readonly string[]).includes(code);

export type Admission =
  | { ok: true; quantity: string }
  | { ok: false; code: MovementRefusal; missing?: ValuedFxKind[] };

// The part of a holding's history a change can reach: the quantity before it
// (null when the change can reach the very first movement) and every movement
// from there on, in any order.
export type MovementWindow = {
  prior: { quantity: string } | null;
  after: readonly Movement[];
};

// Whether a holding's movements make a history: it starts with units coming
// in (an opening balance, a purchase, an adjustment in or a transfer in), an
// opening balance only ever first, and nothing takes out more units than are
// held at that point. Only quantities are read, so the answer is the same in every unit.
// Returns the quantity held after the last one.
export function admitMovements({ prior, after }: MovementWindow): Admission {
  const sorted = [...after].sort(compareMovements);
  let quantity = exactOf(prior?.quantity ?? "0");
  for (const [index, movement] of sorted.entries()) {
    const first = prior === null && index === 0;
    if (
      (movement.kind === "opening_balance" && !first) ||
      (first && !startsHolding(movement))
    ) {
      return { ok: false, code: "opening_balance" };
    }
    quantity = plus(quantity, unitsMoved(movement));
    if (compareExact(quantity, ZERO) < 0) {
      return { ok: false, code: "oversold" };
    }
  }
  return { ok: true, quantity: stored(quantity) };
}

// The units a holding's movements leave it with at the end of a date.
export const quantityOn = (
  movements: readonly Movement[],
  date: string,
): string =>
  stored(
    plus(
      ...movements.filter((movement) => movement.date <= date).map(unitsMoved),
    ),
  );

// A new or edited movement, before its rates are known to be complete: the
// rates its date had may be missing some kind.
export type MovementDraft = {
  [K in Movement["kind"]]: Omit<Extract<Movement, { kind: K }>, "rates"> & {
    rates: Partial<MovementRates>;
  };
}[Movement["kind"]];

// Whether a movement can join a holding's history. An edit passes the history
// without the movement it replaces. Admitted, the movement has every dollar's
// rate, and the euro's when it is in euros.
export function admitMovement(
  window: MovementWindow,
  movement: MovementDraft,
  { today }: { today: string },
): Admission {
  if (movement.date > today) return { ok: false, code: "future_date" };
  const needed: ValuedFxKind[] =
    movement.currency === "EUR" ? [...UNIT_FX_KINDS, "eur"] : UNIT_FX_KINDS;
  const missing = needed.filter((kind) => !movement.rates[kind]);
  if (missing.length > 0) return { ok: false, code: "no_rate", missing };
  return admitMovements({
    prior: window.prior,
    after: [...window.after, movement as Movement],
  });
}
