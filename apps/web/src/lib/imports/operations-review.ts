import { compareDecimals } from "@plant/shared";

import type { ImportOperationRow } from "./review";

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
  if (row.kind === "purchase" || row.kind === "sale") {
    if (!positive(row.quantity)) missing.push("quantity");
    if (!positive(row.price)) missing.push("price");
  } else if (row.kind !== null && !positive(row.amount)) {
    missing.push("amount");
  }
  return missing;
}

// Whether every operation kept is complete, and at least one is kept.
export const operationsComplete = (
  rows: readonly ImportOperationRow[],
  today: string,
) =>
  rows.some((row) => !row.discarded) &&
  rows.every((row) => missingFields(row, today).length === 0);
