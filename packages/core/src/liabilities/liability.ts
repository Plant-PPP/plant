import {
  currencySchema,
  type Exact,
  exactOf,
  fieldsPassed,
  plus,
  positiveDecimalSchema,
  times,
  toDecimal,
} from "@plant/shared";
import { z } from "zod";

import {
  type QuoteNeed,
  SYMBOL_PATTERN,
  type QuoteSnapshot,
} from "../quotes/contract/quote";
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
export const LIABILITY_KINDS = [
  "personal_loan",
  "mortgage",
  "credit_card",
  "usd_debt",
  "crypto_loan",
] as const;
export type LiabilityKind = (typeof LIABILITY_KINDS)[number];

export const LIABILITY_LABEL_MAX = 60;

const label = z.string().trim().min(1).max(LIABILITY_LABEL_MAX);

// A debt by the column names it is stored under. Its balance and installment
// are in its unit: the currency, UVA units when `uva`, or units of
// `instrument_symbol`. The rate is a yearly fraction.
export const liabilityFields = {
  kind: z.enum(LIABILITY_KINDS),
  label,
  lender: label.nullable(),
  currency: currencySchema.nullable(),
  uva: z.boolean(),
  instrument_symbol: z.string().regex(SYMBOL_PATTERN).nullable(),
  balance: positiveDecimalSchema,
  installment: positiveDecimalSchema.nullable(),
  annual_rate: annualRate.nullable(),
  installments_left: z.number().int().positive().max(600).nullable(),
  next_due_on: holdingDateSchema.nullable(),
  matures_on: holdingDateSchema.nullable(),
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

export const liabilityInputSchema = z
  .object(liabilityFields)
  .strict()
  .refine(unitsAgree, {
    message: "The unit does not fit the kind",
    path: ["currency"],
    when: fieldsPassed,
  });

export const liabilitySchema = z
  .object({ id: z.string(), ...liabilityFields })
  .strict()
  .refine(unitsAgree, { message: "The unit does not fit the kind" });
export type Liability = z.output<typeof liabilitySchema>;

// A debt's balance in a view's unit, with the date of the oldest quote used:
// the UVA's day for a UVA debt, a price's for a crypto loan.
export function liabilityValue(
  debt: Pick<Liability, "currency" | "uva" | "instrument_symbol" | "balance">,
  view: Denominator,
  snapshot: QuoteSnapshot,
  referenceDollar: ReferenceDollar,
): { value: Exact; asOf: string } | Missing {
  const balance = exactOf(debt.balance);
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
  debts: readonly Liability[],
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
