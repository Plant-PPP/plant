import { type Exact, type ExactMoney, exactOf, times } from "@plant/shared";
import type { QuoteSnapshot } from "../quotes/contract/quote";
import {
  DENOMINATORS,
  type Denominator,
  type DenominatorSpec,
} from "./denominators";

export type Missing = { missing: string };

// The one read of a price.
export function priceOf(
  symbol: string,
  snapshot: QuoteSnapshot,
): { money: ExactMoney; date: string } | Missing {
  const quote = snapshot.prices[symbol];
  if (!quote) return { missing: symbol };
  return {
    money: { amount: exactOf(quote.price), currency: quote.currency },
    date: quote.date,
  };
}

// The one read of a rate: how many pesos one unit of `denominator` is, at the
// selling price, with the dates of the quotes it used.
export function arsPerUnit(
  denominator: Denominator,
  snapshot: QuoteSnapshot,
): { exact: Exact; dates: string[] } | Missing {
  const spec: DenominatorSpec = DENOMINATORS[denominator];
  if ("fx" in spec) {
    const rate = snapshot.fx[spec.fx];
    if (!rate) return { missing: spec.fx };
    return { exact: exactOf(rate.sell), dates: [rate.date] };
  }
  if ("via" in spec) {
    const base = arsPerUnit(spec.via, snapshot);
    if ("missing" in base) return base;
    const price = viaPerUnit(denominator, snapshot);
    if ("missing" in price) return price;
    return {
      exact: times(base.exact, price.exact),
      dates: [...base.dates, ...price.dates],
    };
  }
  return { exact: { n: 1n, d: 1n }, dates: [] };
}

// How many of its `via` unit one unit priced in another is: its price, which
// must be in USD.
export function viaPerUnit(
  denominator: Denominator,
  snapshot: QuoteSnapshot,
): { exact: Exact; dates: string[] } | Missing {
  const spec: DenominatorSpec = DENOMINATORS[denominator];
  if (!("via" in spec)) throw new RangeError(`${denominator} has no via unit`);
  const price = priceOf(spec.priced, snapshot);
  if ("missing" in price || price.money.currency !== "USD") {
    return { missing: spec.priced };
  }
  return { exact: price.money.amount, dates: [price.date] };
}
