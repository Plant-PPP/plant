import { liabilityInputSchema, normalizeSymbol } from "@plant/core";
import { compareDecimals } from "@plant/shared";

import type { ImportDebtRow } from "./review";

// A debt as the review confirms it: the card debt of the user's it updates,
// or none for a new one.
export type ReviewedDebt = ImportDebtRow & { liabilityId: string | null };

// A card statement's debt, as opposed to a loan's.
export const isCard = (row: Pick<ImportDebtRow, "kind">) =>
  row.kind === null || row.kind === "credit_card";

// The debt a loan statement's row makes, as Deudas stores it: one that
// accrues has no installment or due date.
export function loanInputOf(
  row: Pick<
    ImportDebtRow,
    | "kind"
    | "label"
    | "lender"
    | "currency"
    | "instrumentSymbol"
    | "balance"
    | "minimumPayment"
    | "dueDate"
    | "annualRate"
    | "accrues"
    | "openedOn"
  >,
) {
  const accrues = row.accrues === true;
  return liabilityInputSchema.safeParse({
    kind: row.kind,
    label: row.label,
    lender: row.lender,
    currency: row.currency,
    uva: false,
    instrument_symbol: row.instrumentSymbol,
    balance: row.balance,
    installment: accrues ? null : row.minimumPayment,
    annual_rate: row.annualRate,
    installments_left: null,
    next_due_on: accrues ? null : row.dueDate,
    matures_on: null,
    accrues,
    opened_on: row.openedOn,
  });
}

// What a debt still needs before it is confirmed: a balance, and a name when
// it is a new debt; a loan also its currency, or its crypto when it is owed
// in one, and the day of its balance when it accrues. Its minimum payment,
// due date and rate may stay empty.
export type MissingDebtField =
  "label" | "balance" | "currency" | "instrumentSymbol" | "openedOn";

const positive = (value: string | null) =>
  value !== null &&
  /^\d+(\.\d+)?$/.test(value) &&
  compareDecimals(value, "0") > 0;

export function missingDebtFields(row: ReviewedDebt): MissingDebtField[] {
  if (row.discarded) return [];
  const missing: MissingDebtField[] = [];
  if (row.liabilityId === null && (row.label ?? "").trim() === "") {
    missing.push("label");
  }
  if (!positive(row.balance)) missing.push("balance");
  if (isCard(row)) return missing;
  if (row.kind === "crypto_loan") {
    if (row.instrumentSymbol === null) missing.push("instrumentSymbol");
  } else if (row.currency === null) {
    missing.push("currency");
  }
  if (row.accrues === true && row.openedOn === null) missing.push("openedOn");
  return missing;
}

// Whether every debt kept is complete, and at least one is kept.
export const debtsComplete = (rows: readonly ReviewedDebt[]) =>
  rows.some((row) => !row.discarded) &&
  rows.every((row) => missingDebtFields(row).length === 0);

// The user's card debt a statement's debt updates: the one in its currency
// whose name or bank reads the same, when exactly one does; none otherwise,
// and none for a loan.
export function cardFor(
  debt: Pick<ImportDebtRow, "kind" | "label" | "lender" | "currency">,
  cards: readonly {
    id: string;
    label: string;
    lender: string | null;
    currency: string | null;
  }[],
): string | null {
  const names = [debt.label, debt.lender]
    .filter((each): each is string => each !== null)
    .map(normalizeSymbol)
    .filter((each) => each !== "");
  if (names.length === 0 || !isCard(debt)) return null;
  const same = cards.filter(
    (card) =>
      card.currency === debt.currency &&
      [card.label, card.lender].some(
        (each) => each !== null && names.includes(normalizeSymbol(each)),
      ),
  );
  return same.length === 1 ? same[0]!.id : null;
}
