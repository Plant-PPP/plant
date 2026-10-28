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

// The user's debts whose name or lender reads as one of `names`, however
// written.
export function debtsNamed<D extends { label: string; lender: string | null }>(
  names: readonly (string | null)[],
  debts: readonly D[],
): D[] {
  const wanted = names
    .filter((each): each is string => each !== null)
    .map(normalizeSymbol)
    .filter((each) => each !== "");
  return debts.filter((debt) =>
    [debt.label, debt.lender].some(
      (each) => each !== null && wanted.includes(normalizeSymbol(each)),
    ),
  );
}

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
  if (!isCard(debt)) return null;
  const same = debtsNamed(
    [debt.label, debt.lender],
    cards.filter((card) => card.currency === debt.currency),
  );
  return same.length === 1 ? same[0]!.id : null;
}

// The unit a debt is owed in: a crypto loan's instrument, UVA for a peso
// loan in UVA, else its currency.
export const debtUnit = (debt: {
  currency: string | null;
  uva: boolean;
  instrument_symbol: string | null;
}): string => debt.instrument_symbol ?? (debt.uva ? "UVA" : debt.currency!);

// The debt a repayment in a document of an account pays: of the user's debts
// in the repayment's unit, the one named as the account's institution, else
// the only one; none when that leaves several or none.
export function debtPaid<
  D extends {
    id: string;
    label: string;
    lender: string | null;
    currency: string | null;
    uva: boolean;
    instrument_symbol: string | null;
  },
>(unit: string, institution: string, debts: readonly D[]): D | null {
  const inUnit = debts.filter((debt) => debtUnit(debt) === unit);
  const named = debtsNamed([institution], inUnit);
  if (named.length === 1) return named[0]!;
  return inUnit.length === 1 ? inUnit[0]! : null;
}

// Whether a loan statement's debt is one the user already has in Deudas: one
// in its unit whose name or lender reads as the statement's.
export function loanLoaded(
  row: Pick<
    ImportDebtRow,
    "kind" | "label" | "lender" | "currency" | "instrumentSymbol"
  >,
  loans: readonly {
    label: string;
    lender: string | null;
    currency: string | null;
    instrument_symbol: string | null;
  }[],
): boolean {
  if (isCard(row)) return false;
  const unit = row.instrumentSymbol ?? row.currency;
  return (
    debtsNamed(
      [row.label, row.lender],
      loans.filter(
        (loan) => (loan.instrument_symbol ?? loan.currency) === unit,
      ),
    ).length > 0
  );
}
