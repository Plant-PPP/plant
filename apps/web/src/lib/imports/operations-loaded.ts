import { compareDecimals, exactOf, plus, stored } from "@plant/shared";

import { allRows, type Ledger } from "@/lib/ledger/ledger";

import type { ImportOperationRow } from "./review";

// One of the account's operations on an instrument, its parts across
// portfolios added up.
type Loaded = {
  id: string;
  symbol: string;
  date: string;
  kind: string;
  figure: string | null;
  references: Set<string>;
};

function loadedOperations(state: Ledger, accountId: string): Loaded[] {
  const byOperation = new Map<string, Loaded>();
  for (const row of allRows(state)) {
    if (row.account.id !== accountId) continue;
    if (row.holding.asset_class !== "instrument") continue;
    for (const movement of state.movements.get(row.id) ?? []) {
      const figure =
        "quantity" in movement
          ? movement.quantity
          : "amount" in movement
            ? movement.amount
            : null;
      const key = `${movement.operation_id}|${row.holding.instrument_symbol}`;
      const kept = byOperation.get(key);
      if (kept) {
        if (kept.figure !== null && figure !== null) {
          kept.figure = stored(plus(exactOf(kept.figure), exactOf(figure)));
        }
        if (movement.reference) kept.references.add(movement.reference);
        continue;
      }
      byOperation.set(key, {
        id: key,
        symbol: row.holding.instrument_symbol,
        date: movement.date,
        kind: movement.kind,
        figure,
        references: new Set(movement.reference ? [movement.reference] : []),
      });
    }
  }
  return [...byOperation.values()];
}

// Whether an operation of the account is one a document shows: of its kind
// and instrument (when the document names one) with its transaction number,
// or, with no number, of its instrument on its day, of its kind, with its
// units or its amount across portfolios.
const isSame = (loaded: Loaded, row: ImportOperationRow) => {
  if (loaded.kind !== row.kind) return false;
  if (row.symbol !== "" && loaded.symbol !== row.symbol) return false;
  if (row.reference !== null) return loaded.references.has(row.reference);
  const figure =
    row.kind === "dividend" || row.kind === "coupon"
      ? row.amount
      : row.quantity;
  return (
    row.symbol !== "" &&
    loaded.date === row.date &&
    figure !== null &&
    loaded.figure !== null &&
    compareDecimals(loaded.figure, figure) === 0
  );
};

// The draft's operations with those already in the account set aside, for
// the user to bring back if they are not the same. Each operation of the
// account answers for one row of the draft at most, so two equal fills of a
// day are not both taken for the one already loaded.
export function markLoaded(
  state: Ledger,
  accountId: string,
  rows: readonly ImportOperationRow[],
): ImportOperationRow[] {
  const loaded = loadedOperations(state, accountId);
  const claimed = new Set<string>();
  return rows.map((row) => {
    const match = loaded.find(
      (each) => !claimed.has(each.id) && isSame(each, row),
    );
    if (!match) return row;
    claimed.add(match.id);
    return { ...row, discarded: true, loaded: true };
  });
}
