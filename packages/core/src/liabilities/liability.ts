import {
  compareDecimals,
  Constants,
  currencySchema,
  type Exact,
  exactOf,
  fieldsPassed,
  fromScaled,
  INSTRUMENT_SYMBOL_PATTERN,
  plus,
  positiveDecimalSchema,
  times,
  toDecimal,
  toScaled,
} from "@plant/shared";
import { z } from "zod";

import type { QuoteNeed, QuoteSnapshot } from "../quotes/contract/quote";
import { type ReferenceDollar, express } from "../valuation/denominator";
import { DENOMINATORS, type Denominator } from "../valuation/denominators";
import { quotesNeeded } from "../valuation/holdings";
import {
  annualRate,
  holdingDateSchema,
  instrumentValue,
} from "../valuation/holding";
import type { Missing } from "../valuation/snapshot";

// What a user owes. A mortgage or personal loan may be in UVA, owed in pesos
// at the UVA of the day; a crypto loan is owed in units of an instrument.
export const LIABILITY_KINDS = Constants.public.Enums.liability_kind;
export type LiabilityKind = (typeof LIABILITY_KINDS)[number];

export const LIABILITY_LABEL_MAX = 60;

const label = z.string().trim().min(1).max(LIABILITY_LABEL_MAX);

// A debt by the column names it is stored under. Its balance and installment
// are in its unit: the currency, UVA units when `uva`, or units of
// `instrument_symbol`. The principal, when the lender separates it, is the
// part of the anchor day's balance that is not interest. The balance and rate are those of its anchor day
// (opened_on, or the day it was created); the rate is a yearly fraction.
export const liabilityFields = {
  kind: z.enum(LIABILITY_KINDS),
  label,
  lender: label.nullable(),
  currency: currencySchema.nullable(),
  uva: z.boolean(),
  instrument_symbol: z.string().regex(INSTRUMENT_SYMBOL_PATTERN).nullable(),
  balance: positiveDecimalSchema,
  principal: positiveDecimalSchema.nullable().optional(),
  installment: positiveDecimalSchema.nullable(),
  annual_rate: annualRate.nullable(),
  installments_left: z.number().int().positive().max(600).nullable(),
  next_due_on: holdingDateSchema.nullable(),
  matures_on: holdingDateSchema.nullable(),
  accrues: z.boolean(),
  opened_on: holdingDateSchema.nullable(),
};

type UnitColumns = {
  kind: LiabilityKind;
  currency: string | null;
  uva: boolean;
  instrument_symbol: string | null;
};

// A crypto loan is owed in an instrument and anything else in a currency; only
// a peso loan can be in UVA, and a debt in dollars is in dollars.
export const unitsAgree = (debt: UnitColumns): boolean =>
  debt.kind === "crypto_loan"
    ? debt.instrument_symbol !== null && debt.currency === null && !debt.uva
    : debt.instrument_symbol === null &&
      debt.currency !== null &&
      (!debt.uva || debt.currency === "ARS") &&
      (debt.kind !== "usd_debt" || debt.currency === "USD");

type AccrualColumns = {
  kind: LiabilityKind;
  accrues: boolean;
  opened_on: string | null;
  installment: string | null;
  installments_left: number | null;
  next_due_on: string | null;
};

// A debt that accrues names the day of its balance and has no installment; a
// card never accrues (the liabilities_accrues_* and liabilities_card_plain
// CHECKs).
export const accrualAgrees = (debt: AccrualColumns): boolean =>
  !debt.accrues ||
  (debt.kind !== "credit_card" &&
    debt.opened_on !== null &&
    debt.installment === null &&
    debt.installments_left === null &&
    debt.next_due_on === null);

// The liabilities_principal CHECK: the principal is part of the balance.
export const principalAgrees = (debt: {
  balance: string;
  principal?: string | null;
}): boolean =>
  debt.principal == null || compareDecimals(debt.principal, debt.balance) <= 0;

// What a debt owes split into principal and interest: the interest is what
// the balance on the day adds to the recorded principal, never below 0.
export function principalSplit(
  balance: string,
  principal: string | null | undefined,
): { principal: string; interest: string } | null {
  if (principal == null) return null;
  const interest = toScaled(balance) - toScaled(principal);
  return { principal, interest: fromScaled(interest > 0n ? interest : 0n) };
}

export const liabilityInputSchema = z
  .object(liabilityFields)
  .strict()
  .refine(unitsAgree, {
    message: "The unit does not fit the kind",
    path: ["currency"],
    when: fieldsPassed,
  })
  .refine(accrualAgrees, {
    message: "A debt that accrues has a start date and no installment",
    path: ["accrues"],
    when: fieldsPassed,
  })
  .refine(principalAgrees, {
    message: "The principal is at most the balance",
    path: ["principal"],
    when: fieldsPassed,
  });

export const liabilitySchema = z
  .object({
    id: z.string(),
    anchored_on: holdingDateSchema,
    ...liabilityFields,
  })
  .strict()
  .refine(unitsAgree, { message: "The unit does not fit the kind" })
  .refine(accrualAgrees, { message: "The accrual does not fit the debt" });
export type Liability = z.output<typeof liabilitySchema>;

declare const onDate: unique symbol;

// A debt whose balance is the one computed for a day from its events, the only
// form a debt is valued in; liabilitiesOn makes it.
export type LiabilityOnDate = Liability & { readonly [onDate]: true };

// A debt's balance in a view's unit, with the date of the oldest quote used:
// the UVA's day for a UVA debt, a price's for a crypto loan.
export function liabilityValue(
  debt: Pick<Liability, "currency" | "uva" | "instrument_symbol" | "balance">,
  view: Denominator,
  snapshot: QuoteSnapshot,
  referenceDollar: ReferenceDollar,
): { value: Exact; asOf: string } | Missing {
  const balance = exactOf(debt.balance);
  // Owing nothing needs no quote: a paid-off debt is 0 in any unit.
  if (balance.n === 0n) return { value: balance, asOf: snapshot.date };
  if (debt.instrument_symbol !== null) {
    const one = instrumentValue(
      debt.instrument_symbol,
      view,
      snapshot,
      referenceDollar,
    );
    if ("missing" in one) return one;
    return { value: times(one.value.amount, balance), asOf: one.asOf };
  }
  if (debt.currency === null) return { missing: "currency" };
  let amount = balance;
  let asOf = snapshot.date;
  if (debt.uva) {
    const uva = snapshot.fx.uva;
    if (!uva) return { missing: "uva" };
    amount = times(balance, exactOf(uva.sell));
    asOf = uva.date;
  }
  const shown = express(
    { amount, currency: debt.currency },
    asOf,
    view,
    snapshot,
    referenceDollar,
  );
  if ("missing" in shown) return shown;
  return { value: shown.value.amount, asOf: shown.asOf };
}

export type LiabilitiesValue = {
  total: string;
  complete: boolean;
  items: { id: string; value: string | null; asOf: string | null }[];
};

// Every debt's balance in one unit and their sum; a debt with no quote is
// listed, left out of the sum and makes it incomplete.
export function valueLiabilities(
  debts: readonly LiabilityOnDate[],
  snapshot: QuoteSnapshot,
  {
    denominator,
    referenceDollar,
  }: { denominator: Denominator; referenceDollar: ReferenceDollar },
): LiabilitiesValue {
  const { scale } = DENOMINATORS[denominator];
  let total: Exact = { n: 0n, d: 1n };
  let complete = true;
  const items = debts.map((debt) => {
    const valued = liabilityValue(debt, denominator, snapshot, referenceDollar);
    if ("missing" in valued) {
      complete = false;
      return { id: debt.id, value: null, asOf: null };
    }
    total = plus(total, valued.value);
    return {
      id: debt.id,
      value: toDecimal(valued.value, scale),
      asOf: valued.asOf,
    };
  });
  return { total: toDecimal(total, scale), complete, items };
}

// The quotes valuing these debts in any unit can read: what valuing no
// holding needs, the UVA when a debt is in UVA, and each loaned instrument's
// price.
export function liabilityQuotesNeeded(
  debts: readonly Pick<Liability, "uva" | "instrument_symbol">[],
): QuoteNeed {
  const base = quotesNeeded([]);
  return {
    fxKinds: debts.some((debt) => debt.uva)
      ? [...base.fxKinds, "uva"]
      : base.fxKinds,
    symbols: [
      ...base.symbols,
      ...debts.flatMap((debt) =>
        debt.instrument_symbol === null ? [] : [debt.instrument_symbol],
      ),
    ],
  };
}
