import { compareDecimals } from "@plant/shared";

import type { ImportOperationKind, ImportOperationRow } from "./review";

// The kinds of operation the review offers, each one way of moving the
// account: a trade, an income, units that came in from outside (a deposit,
// at what each unit cost), units that left it (a withdrawal, at the cost of
// the oldest), units sent to another of the user's accounts, or a loan's
// repayment: on its own, or paid from the account.
export const REVIEW_KINDS = [
  {
    id: "purchase",
    kind: "purchase",
    direction: null,
    debtPayment: false,
    label: "Compra",
    needs: ["symbol", "quantity", "price"],
  },
  {
    id: "sale",
    kind: "sale",
    direction: null,
    debtPayment: false,
    label: "Venta",
    needs: ["symbol", "quantity", "price"],
  },
  {
    id: "dividend",
    kind: "dividend",
    direction: null,
    debtPayment: false,
    label: "Dividendo",
    needs: ["symbol", "amount"],
  },
  {
    id: "coupon",
    kind: "coupon",
    direction: null,
    debtPayment: false,
    label: "Cupón",
    needs: ["symbol", "amount"],
  },
  {
    id: "deposit",
    kind: "adjustment",
    direction: "in",
    debtPayment: false,
    label: "Depósito",
    needs: ["symbol", "quantity", "price"],
  },
  {
    id: "withdrawal",
    kind: "adjustment",
    direction: "out",
    debtPayment: false,
    label: "Retiro",
    needs: ["symbol", "quantity"],
  },
  {
    id: "transfer",
    kind: "transfer",
    direction: "out",
    debtPayment: false,
    label: "Traspaso a otra cuenta",
    needs: ["symbol", "quantity", "counterpart"],
  },
  {
    id: "debt_payment",
    kind: null,
    direction: null,
    debtPayment: true,
    label: "Pago de deuda",
    needs: ["quantity", "debt"],
  },
  {
    id: "debt_payment_out",
    kind: "adjustment",
    direction: "out",
    debtPayment: true,
    label: "Pago de deuda desde esta cuenta",
    needs: ["quantity", "debt"],
  },
] as const satisfies readonly {
  id: string;
  kind: ImportOperationKind | null;
  direction: "in" | "out" | null;
  debtPayment: boolean;
  label: string;
  // What an operation of the kind needs beyond its date. A payment is in
  // its debt's unit, so it names no instrument.
  needs: readonly (
    "symbol" | "quantity" | "price" | "amount" | "counterpart" | "debt"
  )[];
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

type Kinded = Pick<ImportOperationRow, "kind" | "direction" | "debtPayment">;

// The review kind an operation is, or null while it has none.
export const reviewKindOf = (row: Kinded): ReviewKind | null =>
  REVIEW_KINDS.find(
    (each) =>
      each.kind === row.kind &&
      each.direction === directionOf(row) &&
      each.debtPayment === (row.debtPayment ?? false),
  ) ?? null;

// The fields an operation of a review kind takes from it.
export const kindFields = (id: ReviewKindId) => {
  const kind = REVIEW_KINDS.find((each) => each.id === id)!;
  return {
    kind: kind.kind,
    direction: kind.direction,
    debtPayment: kind.debtPayment,
  };
};

// Whether an operation moves units at a price per unit: a trade, or a
// deposit valued at what each unit cost.
export const movesUnits = (row: Kinded): boolean =>
  row.kind === "purchase" ||
  row.kind === "sale" ||
  (row.kind === "adjustment" && directionOf(row) === "in");

// Whether an operation moves units with no price: they leave at the cost of
// the oldest. A payment from the account takes its debt's units or cash,
// which the debt says.
export const takesUnitsOut = (row: Kinded): boolean =>
  !(row.debtPayment ?? false) &&
  (row.kind === "transfer" ||
    (row.kind === "adjustment" && directionOf(row) === "out"));

// What an operation still needs before it is confirmed: a date no later than
// today, a kind, an instrument, and a trade's or deposit's units and price,
// units going out (and, for a transfer, the account they go to), an income's
// amount, or a payment's amount and debt. Its charges may stay empty: a
// ticket that prints none has none.
export type MissingField =
  | "date"
  | "kind"
  | "symbol"
  | "quantity"
  | "price"
  | "amount"
  | "counterpart"
  | "debt";

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
  const kind = reviewKindOf(row);
  // Until it has a kind, an operation asks for it and its instrument.
  if (kind === null) {
    missing.push("kind");
    if (row.symbol === "") missing.push("symbol");
    return missing;
  }
  for (const need of kind.needs) {
    const given =
      need === "symbol"
        ? row.symbol !== ""
        : need === "counterpart"
          ? Boolean(row.counterpartId)
          : need === "debt"
            ? Boolean(row.payDebtId)
            : positive(row[need]);
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
  debtPayments: number;
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
    debtPayments: written.filter((row) => row.debtPayment).length,
    loaded: toWrite.filter(
      (row, index) => row.discarded && !reviewed[index]!.discarded,
    ).length,
  };
}
