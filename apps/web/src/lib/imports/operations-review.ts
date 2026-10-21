import { compareDecimals } from "@plant/shared";

import type { ImportOperationKind, ImportOperationRow } from "./review";

// Whether an operation moves units at a price per unit: a trade, or a
// deposit valued at what each unit cost.
export const movesUnits = (kind: ImportOperationKind | null): boolean =>
  kind === "purchase" || kind === "sale" || kind === "adjustment";

// The review's name for each kind: an imported adjustment is units that
// came in from outside, a deposit.
export const IMPORT_KIND_LABELS: Record<ImportOperationKind, string> = {
  purchase: "Compra",
  sale: "Venta",
  dividend: "Dividendo",
  coupon: "Cupón",
  adjustment: "Depósito",
};

// What an operation still needs before it is confirmed: a date no later than
// today, a kind, an instrument, and a trade's units and price or an income's
// amount. Its charges may stay empty: a ticket that prints none has none.
export type MissingField =
  "date" | "kind" | "symbol" | "quantity" | "price" | "amount";

const positive = (value: string | null) =>
  value !== null &&
  /^\d+(\.\d+)?$/.test(value) &&
  compareDecimals(value, "0") > 0;

export function missingFields(
  row: ImportOperationRow,
  today: string,
): MissingField[] {
  if (row.discarded) return [];
  const missing: MissingField[] = [];
  if (row.date === null || row.date > today) missing.push("date");
  if (row.kind === null) missing.push("kind");
  if (row.symbol === "") missing.push("symbol");
  if (movesUnits(row.kind)) {
    if (!positive(row.quantity)) missing.push("quantity");
    if (!positive(row.price)) missing.push("price");
  } else if (row.kind !== null && !positive(row.amount)) {
    missing.push("amount");
  }
  return missing;
}

// Whether every operation kept is complete, and at least one is kept, or
// the import brings movements of cash to confirm on their own.
export const operationsComplete = (
  rows: readonly ImportOperationRow[],
  today: string,
  withCash = false,
) =>
  (withCash || rows.some((row) => !row.discarded)) &&
  rows.every((row) => missingFields(row, today).length === 0);
