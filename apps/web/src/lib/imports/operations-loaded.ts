import { compareDecimals, exactOf, plus, stored } from "@plant/shared";

import { allRows, type Ledger } from "@/lib/ledger/ledger";

import type { ImportOperationRow } from "./review";

// What an operation does to the account's units, for telling one document row
// from another: units in or out are one movement whether they came by
// adjustment or by transfer, since a withdrawal read from one account's history
// is the out part of a transfer between two of the user's accounts.
const motionOf = (kind: string, direction: "in" | "out" | null): string =>
  (kind === "adjustment" || kind === "transfer") && direction !== null
    ? `units ${direction}`
    : kind;

// One of the account's operations on an instrument, its parts across
// portfolios that move units the same way added up.
type Loaded = {
  id: string;
  operation: string;
  symbol: string;
  date: string;
  motion: string;
  figure: string | null;
  references: Set<string>;
};

function loadedOperations(state: Ledger, accountId: string): Loaded[] {
  const byOperation = new Map<string, Loaded>();
  // A transfer between two portfolios of the account moves nothing in or out
  // of it, so no document row of the account is one.
  const directions = new Map<string, Set<string>>();
  for (const row of allRows(state)) {
    if (row.account.id !== accountId) continue;
    if (row.holding.asset_class !== "instrument") continue;
    for (const movement of state.movements.get(row.id) ?? []) {
      const direction = "direction" in movement ? movement.direction : null;
      const figure =
        "quantity" in movement
          ? movement.quantity
          : "amount" in movement
            ? movement.amount
            : null;
      const operation = `${movement.operation_id}|${row.holding.instrument_symbol}`;
      if (movement.kind === "transfer" && direction !== null) {
        const seen = directions.get(operation) ?? new Set<string>();
        directions.set(operation, seen.add(direction));
      }
      const key = `${operation}|${direction ?? ""}`;
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
        operation,
        symbol: row.holding.instrument_symbol,
        date: movement.date,
        motion: motionOf(movement.kind, direction),
        figure,
        references: new Set(movement.reference ? [movement.reference] : []),
      });
    }
  }
  return [...byOperation.values()].filter(
    (each) => (directions.get(each.operation)?.size ?? 0) < 2,
  );
}

// Where a row looks for its loaded operation: under its transaction number
// when it has one, then under its instrument and day. One with no kind, or
// with no number and no instrument or day, is none of the account's; nor is
// a debt payment, which its debt's payments tell.
function lookupsOf(
  row: ImportOperationRow,
): { key: string; byNumber: boolean }[] {
  if (row.kind === null || row.debtPayment) return [];
  const motion = motionOf(
    row.kind,
    row.kind === "transfer" ? "out" : (row.direction ?? null),
  );
  return [
    ...(row.reference !== null
      ? [{ key: `${motion}|#${row.reference}`, byNumber: true }]
      : []),
    ...(row.symbol !== "" && row.date !== null
      ? [{ key: `${motion}|${row.symbol}|${row.date}`, byNumber: false }]
      : []),
  ];
}

function indexed(loaded: readonly Loaded[]): Map<string, Loaded[]> {
  const index = new Map<string, Loaded[]>();
  const add = (key: string, each: Loaded) =>
    index.set(key, [...(index.get(key) ?? []), each]);
  for (const each of loaded) {
    for (const reference of each.references) {
      add(`${each.motion}|#${reference}`, each);
    }
    add(`${each.motion}|${each.symbol}|${each.date}`, each);
  }
  return index;
}

// Whether an operation of the account is one a document shows: moving units
// the same way, of its instrument (when the document names one), with its
// transaction number, or else on its day with its units or its amount across
// portfolios. A row with a number is taken that way only for an operation
// loaded with none (as the assistant or a hand-typed one), never for one
// under another number.
const isSame = (loaded: Loaded, row: ImportOperationRow, byNumber: boolean) => {
  if (row.symbol !== "" && loaded.symbol !== row.symbol) return false;
  if (byNumber) return true;
  if (row.reference !== null && loaded.references.size > 0) return false;
  const figure =
    row.kind === "dividend" || row.kind === "coupon"
      ? row.amount
      : row.quantity;
  return (
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
  { byNumberOnly = false } = {},
): ImportOperationRow[] {
  const index = indexed(loadedOperations(state, accountId));
  const claimed = new Set<string>();
  return rows.map((row) => {
    let match: Loaded | undefined;
    for (const { key, byNumber } of lookupsOf(row)) {
      if (byNumberOnly && !byNumber) continue;
      match = index
        .get(key)
        ?.find((each) => !claimed.has(each.id) && isSame(each, row, byNumber));
      if (match) break;
    }
    if (!match) return row;
    claimed.add(match.id);
    return { ...row, discarded: true, loaded: true };
  });
}

// Whether another of the user's accounts already shows a transfer's units
// coming in: under its number, or on its day with its units.
export function arrived(
  state: Ledger,
  accountId: string,
  row: ImportOperationRow,
): boolean {
  const arriving = {
    ...row,
    kind: "adjustment" as const,
    direction: "in" as const,
  };
  return markLoaded(state, accountId, [
    arriving,
    { ...arriving, reference: null },
  ]).some((each) => each.loaded);
}

// The reviewed operations with each one the account already holds under its
// transaction number discarded, whatever the review sent: a second tab, or a
// review read before another import was confirmed, never writes it twice. One
// with no number stays as the user left it.
export function withoutLoaded(
  state: Ledger,
  accountId: string,
  rows: readonly ImportOperationRow[],
): ImportOperationRow[] {
  const marked = markLoaded(state, accountId, rows, { byNumberOnly: true });
  return rows.map((row, index) =>
    row.reference !== null && marked[index]!.loaded && !row.discarded
      ? { ...row, discarded: true }
      : row,
  );
}

// The draft's debt payments with those their debt already has set aside: a
// payment of that debt on that day of that amount. Each payment answers for
// one row at most.
export function markPaymentsLoaded(
  rows: readonly ImportOperationRow[],
  paid: readonly { liability_id: string; date: string; amount: string }[],
): ImportOperationRow[] {
  const byDay = new Map<string, string[]>();
  for (const each of paid) {
    const key = `${each.liability_id}|${each.date}`;
    byDay.set(key, [...(byDay.get(key) ?? []), each.amount]);
  }
  return rows.map((row) => {
    if (!row.debtPayment || !row.payDebtId || row.quantity === null) {
      return row;
    }
    const amounts = byDay.get(`${row.payDebtId}|${row.date}`) ?? [];
    const at = amounts.findIndex(
      (amount) => compareDecimals(amount, row.quantity!) === 0,
    );
    if (at < 0) return row;
    amounts.splice(at, 1);
    return { ...row, discarded: true, loaded: true };
  });
}
