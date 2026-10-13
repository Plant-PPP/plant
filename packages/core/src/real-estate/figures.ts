import {
  compareExact,
  type ExactMoney,
  minus,
  over,
  plus,
  stored,
  times,
  toDecimal,
  ZERO,
} from "@plant/shared";

import { type Liability, liabilityValue } from "../liabilities/liability";
import type { QuoteSnapshot } from "../quotes/contract/quote";
import { express, type ReferenceDollar } from "../valuation/denominator";
import type { Denominator } from "../valuation/denominators";

// What a property is worth, what it cost, and what it brings in and costs
// each month, each amount in its own currency; the debt that paid for it, if
// any, costs its installment.
export type RealEstateTerms = {
  value: ExactMoney;
  purchase: ExactMoney | null;
  monthlyRent: ExactMoney | null;
  monthlyExpenses: ExactMoney | null;
  debt: Pick<
    Liability,
    "currency" | "uva" | "instrument_symbol" | "installment"
  > | null;
};

// A property's figures in a view's unit: what is left each month after the
// expenses and the debt's installment, the rent net of expenses over a year
// as a fraction of what it is worth, and what it gained over what it cost,
// in amount and as a fraction of the cost. A figure needing a quote the
// snapshot lacks is null; so is one with nothing to compute it from.
export type RealEstateFigures = {
  netMonthly: string | null;
  rentalYield: string | null;
  appreciation: { amount: string; share: string | null } | null;
};

export function realEstateFigures(
  terms: RealEstateTerms,
  view: Denominator,
  snapshot: QuoteSnapshot,
  referenceDollar: ReferenceDollar,
): RealEstateFigures {
  const inView = (money: ExactMoney | null) => {
    if (money === null) return ZERO;
    const shown = express(
      money,
      snapshot.date,
      view,
      snapshot,
      referenceDollar,
    );
    return "missing" in shown ? null : shown.value.amount;
  };
  const value = inView(terms.value);
  const rent = inView(terms.monthlyRent);
  const expenses = inView(terms.monthlyExpenses);
  const installment =
    terms.debt?.installment == null
      ? ZERO
      : (() => {
          const shown = liabilityValue(
            { ...terms.debt, balance: terms.debt.installment },
            view,
            snapshot,
            referenceDollar,
          );
          return "missing" in shown ? null : shown.value;
        })();
  const purchase = terms.purchase === null ? null : inView(terms.purchase);

  const netMonthly =
    rent === null || expenses === null || installment === null
      ? null
      : stored(minus(rent, plus(expenses, installment)));
  const rentalYield =
    terms.monthlyRent === null ||
    rent === null ||
    expenses === null ||
    value === null ||
    compareExact(value, ZERO) <= 0
      ? null
      : toDecimal(
          over(times(minus(rent, expenses), { n: 12n, d: 1n }), value),
          6,
        );
  const appreciation =
    purchase === null || value === null
      ? null
      : {
          amount: stored(minus(value, purchase)),
          share:
            compareExact(purchase, ZERO) <= 0
              ? null
              : toDecimal(over(minus(value, purchase), purchase), 6),
        };
  return { netMonthly, rentalYield, appreciation };
}
