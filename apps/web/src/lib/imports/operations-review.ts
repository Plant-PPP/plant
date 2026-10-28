import { compareDecimals } from "@plant/shared";

import type { ImportOperationKind, ImportOperationRow } from "./review";

// The kinds of operation the review offers, each one way of moving the
// account: a trade, an income, units that came in from outside (a deposit,
// at what each unit cost), units that left it (a withdrawal, at the cost of
// the oldest), or units sent to another of the user's accounts.
export const REVIEW_KINDS = [
  {
    id: "purchase",
    kind: "purchase",
    direction: null,
    label: "Compra",
    needs: ["quantity", "price"],
  },
  {
    id: "sale",
    kind: "sale",
    direction: null,
    label: "Venta",
    needs: ["quantity", "price"],
  },
  {
    id: "dividend",
    kind: "dividend",
    direction: null,
    label: "Dividendo",
    needs: ["amount"],
  },
  {
    id: "coupon",
    kind: "coupon",
    direction: null,
    label: "Cupón",
    needs: ["amount"],
  },
  {
    id: "deposit",
    kind: "adjustment",
    direction: "in",
    label: "Depósito",
    needs: ["quantity", "price"],
  },
  {
    id: "withdrawal",
    kind: "adjustment",
    direction: "out",
    label: "Retiro",
    needs: ["quantity"],
  },
  {
    id: "transfer",
    kind: "transfer",
    direction: "out",
    label: "Traspaso a otra cuenta",
    needs: ["quantity", "counterpart"],
  },
] as const satisfies readonly {
  id: string;
  kind: ImportOperationKind;
  direction: "in" | "out" | null;
  label: string;
  // What an operation of the kind needs beyond its date and instrument.
  needs: readonly ("quantity" | "price" | "amount" | "counterpart")[];
}[];

export type ReviewKind = (typeof REVIEW_KINDS)[number];
export type ReviewKindId = ReviewKind["id"];

// Which way an operation moves units: an adjustment read before directions
// were kept came in, and a transfer in a review always leaves.
export const directionOf = (
  row: Pick<ImportOperationRow, "kind" | "direction">,
): "in" | "out" | null =>
  row.kind === "adjustment"
    ? (row.direction ?? "in")
    : row.kind === "transfer"
      ? "out"
      : null;

// The review kind an operation is, or null while it has no kind.
export const reviewKindOf = (
  row: Pick<ImportOperationRow, "kind" | "direction">,
): ReviewKind | null =>
  REVIEW_KINDS.find(
    (each) => each.kind === row.kind && each.direction === directionOf(row),
  ) ?? null;

// The fields an operation of a review kind takes from it.
export const kindFields = (id: ReviewKindId) => {
  const kind = REVIEW_KINDS.find((each) => each.id === id)!;
  return { kind: kind.kind, direction: kind.direction };
};

// Whether an operation moves units at a price per unit: a trade, or a
// deposit valued at what each unit cost.
export const movesUnits = (
  row: Pick<ImportOperationRow, "kind" | "direction">,
): boolean =>
  row.kind === "purchase" ||
  row.kind === "sale" ||
  (row.kind === "adjustment" && directionOf(row) === "in");

// Whether an operation moves units with no price: they leave at the cost of
// the oldest.
export const takesUnitsOut = (
  row: Pick<ImportOperationRow, "kind" | "direction">,
): boolean =>
  row.kind === "transfer" ||
  (row.kind === "adjustment" && directionOf(row) === "out");

// What an operation still needs before it is confirmed: a date no later than
// today, a kind, an instrument, and a trade's or deposit's units and price,
// units going out (and, for a transfer, the account they go to), or an
// income's amount. Its charges may stay empty: a ticket that prints none has none.
export type MissingField =
  "date" | "kind" | "symbol" | "quantity" | "price" | "amount" | "counterpart";

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
  for (const need of reviewKindOf(row)?.needs ?? []) {
    const given =
      need === "counterpart" ? Boolean(row.counterpartId) : positive(row[need]);
    if (!given) missing.push(need);
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

// What the reviewed operations moved, counted, and how many the account
// already held under their number.
export type KeptCounts = {
  transfers: number;
  unitsOut: number;
  loaded: number;
};

export function keptCounts(
  reviewed: readonly ImportOperationRow[],
  toWrite: readonly ImportOperationRow[],
): KeptCounts {
  const written = toWrite.filter((row) => !row.discarded);
  return {
    transfers: written.filter((row) => row.kind === "transfer").length,
    unitsOut: written.filter(
      (row) => row.kind === "adjustment" && takesUnitsOut(row),
    ).length,
    loaded: toWrite.filter(
      (row, index) => row.discarded && !reviewed[index]!.discarded,
    ).length,
  };
}
