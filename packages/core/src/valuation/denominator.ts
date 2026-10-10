import {
  type Database,
  type Exact,
  type ExactMoney,
  over,
  times,
} from "@plant/shared";
import type { QuoteSnapshot } from "../quotes/contract/quote";
import {
  DENOMINATORS,
  type Denominator,
  type DenominatorSpec,
} from "./denominators";
import { type Missing, arsPerUnit, viaPerUnit } from "./snapshot";

export type ReferenceDollar = Database["public"]["Enums"]["reference_dollar"];

// An amount in a unit; exact until it is shown.
export type Value = { amount: Exact; denominator: Denominator };

// Money a user holds, as a value in a view's unit. Pesos are pesos; a held
// dollar becomes the dollar the view's entry names, so it keeps its face
// value in any dollar view and an ARS view prices it at the reference dollar.
export function lift(
  money: ExactMoney,
  view: Denominator,
  referenceDollar: ReferenceDollar,
): Value {
  if (money.currency === "ARS")
    return { amount: money.amount, denominator: "ars" };
  if (money.currency !== "USD") {
    const currency: never = money.currency;
    throw new RangeError(`No unit holds ${String(currency)}`);
  }
  const held = DENOMINATORS[view].heldUsd;
  const denominator: Denominator =
    held === "self"
      ? view
      : held === "reference"
        ? `usd_${referenceDollar}`
        : held;
  return { amount: money.amount, denominator };
}

// A value in another unit, with the dates of the quotes used: by the price
// alone between a unit and the one it is priced in, else through pesos.
export function convert(
  value: Value,
  to: Denominator,
  snapshot: QuoteSnapshot,
): { value: Value; dates: string[] } | Missing {
  if (value.denominator === to) return { value, dates: [] };
  const toSpec: DenominatorSpec = DENOMINATORS[to];
  const fromSpec: DenominatorSpec = DENOMINATORS[value.denominator];
  if ("via" in toSpec && toSpec.via === value.denominator) {
    const price = viaPerUnit(to, snapshot);
    if ("missing" in price) return price;
    return {
      value: { amount: over(value.amount, price.exact), denominator: to },
      dates: price.dates,
    };
  }
  if ("via" in fromSpec && fromSpec.via === to) {
    const price = viaPerUnit(value.denominator, snapshot);
    if ("missing" in price) return price;
    return {
      value: { amount: times(value.amount, price.exact), denominator: to },
      dates: price.dates,
    };
  }
  const from = arsPerUnit(value.denominator, snapshot);
  if ("missing" in from) return from;
  const target = arsPerUnit(to, snapshot);
  if ("missing" in target) return target;
  return {
    value: {
      amount: over(times(value.amount, from.exact), target.exact),
      denominator: to,
    },
    dates: [...from.dates, ...target.dates],
  };
}

export function rate(
  from: Denominator,
  to: Denominator,
  snapshot: QuoteSnapshot,
): { amount: Exact; dates: string[] } | Missing {
  const converted = convert(
    { amount: { n: 1n, d: 1n }, denominator: from },
    to,
    snapshot,
  );
  if ("missing" in converted) return converted;
  return { amount: converted.value.amount, dates: converted.dates };
}

// Money in a view, dated by the oldest of `asOf` and the quotes behind it.
export function express(
  money: ExactMoney,
  asOf: string,
  view: Denominator,
  snapshot: QuoteSnapshot,
  referenceDollar: ReferenceDollar,
): { value: Value; asOf: string } | Missing {
  const converted = convert(lift(money, view, referenceDollar), view, snapshot);
  if ("missing" in converted) return converted;
  return {
    value: converted.value,
    asOf: [asOf, ...converted.dates].reduce((a, b) => (b < a ? b : a)),
  };
}
