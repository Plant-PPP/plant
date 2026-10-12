import { compareExact, exactOf, minus, plus, stored } from "@plant/shared";
import { UNIT_FX_KINDS, type UnitFxKind } from "../valuation/denominators";
import {
  isTrade,
  type Movement,
  type MovementRates,
  startsHolding,
  takesUnits,
} from "./movement";
import { compareMovements } from "./order";

export type MovementRefusal =
  "oversold" | "opening_balance" | "future_date" | "no_rate";

// The refusals that depend on where a movement stands within its day.
export const isOrderRefusal = (code: string): boolean =>
  code === "oversold" || code === "opening_balance";

export type Admission =
  | { ok: true; quantity: string }
  | { ok: false; code: MovementRefusal; missing?: UnitFxKind[] };

// The part of a holding's history a change can reach: the quantity before it
// (null when the change can reach the very first movement) and every movement
// from there on, in any order.
export type MovementWindow = {
  prior: { quantity: string } | null;
  after: readonly Movement[];
};

// Whether a holding's movements make a history: it starts with units coming
// in (an opening balance, a purchase or an adjustment in), an opening balance
// only ever first, and nothing takes out more units than are held at that
// point. Only quantities are read, so the answer is the same in every unit.
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
    if (!isTrade(movement)) continue;
    const moved = exactOf(movement.quantity);
    if (takesUnits(movement)) {
      if (compareExact(moved, quantity) > 0) {
        return { ok: false, code: "oversold" };
      }
      quantity = minus(quantity, moved);
    } else {
      quantity = plus(quantity, moved);
    }
  }
  return { ok: true, quantity: stored(quantity) };
}

// A new or edited movement, before its rates are known to be complete: the
// dollar rates its date had may be missing some kind.
export type MovementDraft = {
  [K in Movement["kind"]]: Omit<Extract<Movement, { kind: K }>, "rates"> & {
    rates: Partial<MovementRates>;
  };
}[Movement["kind"]];

// Whether a movement can join a holding's history. An edit passes the history
// without the movement it replaces. Admitted, the movement's rates are
// complete.
export function admitMovement(
  window: MovementWindow,
  movement: MovementDraft,
  { today }: { today: string },
): Admission {
  if (movement.date > today) return { ok: false, code: "future_date" };
  const missing = UNIT_FX_KINDS.filter((kind) => !movement.rates[kind]);
  if (missing.length > 0) return { ok: false, code: "no_rate", missing };
  return admitMovements({
    prior: window.prior,
    after: [...window.after, movement as Movement],
  });
}
