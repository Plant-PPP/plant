import {
  Constants,
  decimalStringSchema,
  type Exact,
  exactOf,
  minus,
  plus,
  ZERO,
} from "@plant/shared";
import { z } from "zod";

import { holdingDateSchema } from "../valuation/holding";
import { movementRatesSchema } from "./movement";

// What happens to a cash holding with a history. It starts with its opening
// balance, what it held before anything Plant knows; deposits and
// withdrawals are money the user put in or took out; income (a broker's
// interest) and charges (a fee on no operation) are what the cash made or
// cost; a settlement is an operation's cash in this holding (a purchase paid,
// a sale or a dividend collected), so the operation moved money between the
// user's holdings instead of in or out of them.
export const CASH_MOVEMENT_KINDS = Constants.public.Enums.cash_movement_kind;
export type CashMovementKind = (typeof CASH_MOVEMENT_KINDS)[number];

// Signed: what the movement added to the holding, in its currency.
export const cashMovementSchema = z
  .object({
    id: z.string(),
    holding_id: z.string(),
    operation_id: z.string().nullable(),
    kind: z.enum(CASH_MOVEMENT_KINDS),
    date: holdingDateSchema,
    amount: decimalStringSchema,
    reference: z.string().nullable(),
    note: z.string().nullable(),
    rates: movementRatesSchema,
  })
  .strict();
export type CashMovement = z.output<typeof cashMovementSchema>;

export const openingOf = (
  history: readonly CashMovement[],
): CashMovement | undefined =>
  history.find((movement) => movement.kind === "opening_balance");

// What a cash holding with a history held at the end of `date`: what it holds
// today less what its movements after that day added. Before its opening
// balance it held what it did right after it: what it held before Plant knew
// is that balance, never money put in.
export function cashHeldAt(
  history: readonly CashMovement[],
  today: Exact,
  date: string,
): Exact {
  const opening = openingOf(history);
  const from = opening && date < opening.date ? opening.date : null;
  let after = ZERO;
  for (const movement of history) {
    if (movement === opening) continue;
    if (from === null ? movement.date > date : movement.date >= from) {
      after = plus(after, exactOf(movement.amount));
    }
  }
  return minus(today, after);
}

export type CashRefusal = "needs_opening" | "before_opening" | "future";

// Why a holding's history as a write would leave it cannot stand, or null: a
// history starts with one opening balance, nothing comes before it, and
// nothing is dated after today. Whether the balance stays at or above 0 is
// the database's to say, since it holds today's amount.
export function admitCashHistory(
  history: readonly Pick<CashMovement, "kind" | "date">[],
  today: string,
): CashRefusal | null {
  if (history.length === 0) return null;
  const openings = history.filter((each) => each.kind === "opening_balance");
  if (openings.length !== 1) return "needs_opening";
  if (history.some((each) => each.date > today)) return "future";
  return history.some((each) => each.date < openings[0]!.date)
    ? "before_opening"
    : null;
}
