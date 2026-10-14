import { normalizeSymbol } from "@plant/core";
import { compareDecimals } from "@plant/shared";

import type { ImportDebtRow } from "./review";

// A debt as the review confirms it: the card debt of the user's it updates,
// or none for a new one.
export type ReviewedDebt = ImportDebtRow & { liabilityId: string | null };

// What a debt still needs before it is confirmed: a balance, and a name when
// it is a new debt. Its minimum payment and due date may stay empty.
export type MissingDebtField = "label" | "balance";

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
  return missing;
}

// Whether every debt kept is complete, and at least one is kept.
export const debtsComplete = (rows: readonly ReviewedDebt[]) =>
  rows.some((row) => !row.discarded) &&
  rows.every((row) => missingDebtFields(row).length === 0);

// The user's card debt a statement's debt updates: the one in its currency
// whose name or bank reads the same, when exactly one does; none otherwise.
export function cardFor(
  debt: Pick<ImportDebtRow, "label" | "lender" | "currency">,
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
  if (names.length === 0) return null;
  const same = cards.filter(
    (card) =>
      card.currency === debt.currency &&
      [card.label, card.lender].some(
        (each) => each !== null && names.includes(normalizeSymbol(each)),
      ),
  );
  return same.length === 1 ? same[0]!.id : null;
}
