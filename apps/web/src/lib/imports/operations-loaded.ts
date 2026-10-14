import { compareDecimals } from "@plant/shared";

import { allRows, type Ledger } from "@/lib/ledger/ledger";

import type { ImportOperationRow } from "./review";

// Whether the account already has an operation a document shows: one with
// its transaction number, or one of its instrument on its day, of its kind,
// with its units or its amount.
export function alreadyLoaded(
  state: Ledger,
  accountId: string,
  row: ImportOperationRow,
): boolean {
  for (const each of allRows(state)) {
    if (each.account.id !== accountId) continue;
    if (each.holding.asset_class !== "instrument") continue;
    for (const movement of state.movements.get(each.id) ?? []) {
      if (
        row.reference !== null &&
        movement.reference !== null &&
        movement.reference === row.reference
      ) {
        return true;
      }
      if (
        row.symbol === "" ||
        each.holding.instrument_symbol !== row.symbol ||
        movement.date !== row.date ||
        movement.kind !== row.kind
      ) {
        continue;
      }
      const figure =
        "quantity" in movement && row.quantity !== null
          ? compareDecimals(movement.quantity, row.quantity) === 0
          : "amount" in movement &&
            movement.amount !== null &&
            row.amount !== null &&
            compareDecimals(movement.amount, row.amount) === 0;
      if (figure) return true;
    }
  }
  return false;
}

// The draft's operations with those already in the account set aside, for
// the user to bring back if they are not the same.
export const markLoaded = (
  state: Ledger,
  accountId: string,
  rows: readonly ImportOperationRow[],
): ImportOperationRow[] =>
  rows.map((row) =>
    alreadyLoaded(state, accountId, row)
      ? { ...row, discarded: true, loaded: true }
      : row,
  );
