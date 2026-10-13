import type { Liability, LiabilityKind } from "@plant/core";
import type { Currency } from "@plant/shared";

import {
  amountInput,
  parseAmountInput,
  percentInput,
  percentToFraction,
} from "@/lib/format/amount";

export { LIABILITY_KIND_LABELS } from "@/lib/debts/labels";

// What the debt dialog holds, as typed.
export type DebtFields = {
  kind: LiabilityKind;
  label: string;
  lender: string;
  currency: Currency;
  uva: boolean;
  instrument: string;
  balance: string;
  installment: string;
  rate: string;
  installmentsLeft: string;
  nextDueOn: string;
  maturesOn: string;
};

export function debtFields(debt: Liability | null): DebtFields {
  if (!debt) {
    return {
      kind: "personal_loan",
      label: "",
      lender: "",
      currency: "ARS",
      uva: false,
      instrument: "",
      balance: "",
      installment: "",
      rate: "",
      installmentsLeft: "",
      nextDueOn: "",
      maturesOn: "",
    };
  }
  return {
    kind: debt.kind,
    label: debt.label,
    lender: debt.lender ?? "",
    currency: debt.currency ?? "ARS",
    uva: debt.uva,
    instrument: debt.instrument_symbol ?? "",
    balance: amountInput(debt.balance),
    installment: debt.installment ? amountInput(debt.installment) : "",
    rate: debt.annual_rate ? percentInput(debt.annual_rate) : "",
    installmentsLeft: debt.installments_left
      ? String(debt.installments_left)
      : "",
    nextDueOn: debt.next_due_on ?? "",
    maturesOn: debt.matures_on ?? "",
  };
}

// The unit a kind is owed in: a dollar debt in dollars, a crypto loan in an
// instrument, anything else in pesos or dollars, and UVA only in pesos.
export function withKind(fields: DebtFields, kind: LiabilityKind): DebtFields {
  return {
    ...fields,
    kind,
    currency: kind === "usd_debt" ? "USD" : fields.currency,
    uva: (kind === "mortgage" || kind === "personal_loan") && fields.uva,
  };
}

const optional = (text: string) => (text.trim() === "" ? null : text.trim());

// An optional field as its parser reads it, or as typed when it cannot.
const parsedOr = (text: string, parse: (text: string) => string | null) =>
  optional(text) === null ? null : (parse(text) ?? text);

// What the dialog sends. A typed value the parsers refuse goes as the text,
// for the schema to refuse; a field left empty goes as null.
export function toLiabilityInput(fields: DebtFields) {
  const crypto = fields.kind === "crypto_loan";
  const left = optional(fields.installmentsLeft);
  return {
    kind: fields.kind,
    label: fields.label,
    lender: optional(fields.lender),
    currency: crypto ? null : fields.currency,
    uva: !crypto && fields.currency === "ARS" && fields.uva,
    instrument_symbol: crypto ? optional(fields.instrument) : null,
    balance: parseAmountInput(fields.balance),
    installment: parsedOr(fields.installment, parseAmountInput),
    annual_rate: parsedOr(fields.rate, percentToFraction),
    installments_left: left === null ? null : Number(left),
    next_due_on: optional(fields.nextDueOn),
    matures_on: optional(fields.maturesOn),
  };
}

// The unit a debt's amounts are in, as the dialog and table name it. A debt
// owes in an instrument or a currency, so "—" only stands in while the dialog
// has neither picked yet.
export const unitOf = (
  debt: Pick<Liability, "currency" | "uva" | "instrument_symbol">,
): string =>
  debt.instrument_symbol ?? (debt.uva ? "UVA" : debt.currency) ?? "—";
