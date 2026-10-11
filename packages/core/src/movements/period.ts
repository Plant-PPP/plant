import {
  compareExact,
  daysBetween,
  type Exact,
  exactOf,
  minus,
  negated,
  over,
  plus,
  stored,
  times,
  ZERO,
} from "@plant/shared";

import type { CashFlow } from "./returns";

const ONE: Exact = { n: 1n, d: 1n };
const text = stored;

// What a period made, in one unit, from what the holdings were worth at its
// start and end and the cash flows between them:
// - paidIn: purchases and adjustments in, at their cost before charges;
// - proceeds: sales before charges, and adjustments out at the cost they
//   take, so units an adjustment removes carry their unrealized gain into
//   the market result of its period;
// - income: dividends and coupons before withholding;
// - charges: commissions, fees, taxes and withholding;
// - contributed: paidIn less proceeds, what the holder put in net;
// - market: the change in value not explained by what was put in or taken
//   out, from prices and the dollar alone;
// - result: market plus income less charges;
// - share: result over the money at work, each flow weighted by the part of
//   the period it was in (the modified Dietz return), so putting money in
//   is not a gain; 0 when nothing was at work and nothing was made, and null
//   when something was made out of no money at work.
export type PeriodResult = {
  startValue: string;
  endValue: string;
  paidIn: string;
  proceeds: string;
  income: string;
  charges: string;
  contributed: string;
  market: string;
  result: string;
  share: string | null;
};

// The flows are those dated after `from` and on or before `to`.
export function periodResult({
  from,
  to,
  startValue,
  endValue,
  flows,
}: {
  from: string;
  to: string;
  startValue: string;
  endValue: string;
  flows: readonly CashFlow[];
}): PeriodResult {
  const start = exactOf(startValue);
  const end = exactOf(endValue);
  const days = Math.max(1, daysBetween(from, to));
  let paidIn = ZERO;
  let proceeds = ZERO;
  let income = ZERO;
  let charges = ZERO;
  // The money at work: the start value, plus each flow in for the part of
  // the period after it, less each flow out likewise.
  let atWork = start;
  for (const flow of flows) {
    const amount = exactOf(flow.amount);
    const paid = exactOf(flow.charges);
    charges = plus(charges, paid);
    // What changed hands before charges: a purchase cost the flow less its
    // charges, a sale or an income brought it plus them.
    if (flow.kind === "income") income = plus(income, amount, paid);
    else if (compareExact(amount, ZERO) < 0) {
      paidIn = plus(paidIn, negated(amount), negated(paid));
    } else proceeds = plus(proceeds, amount, paid);
    const weight = over(
      { n: BigInt(daysBetween(flow.date, to)), d: 1n },
      { n: BigInt(days), d: 1n },
    );
    atWork = minus(atWork, times(amount, weight));
  }
  const contributed = minus(paidIn, proceeds);
  const market = minus(minus(end, start), contributed);
  const result = minus(plus(market, income), charges);
  return {
    startValue: text(start),
    endValue: text(end),
    paidIn: text(paidIn),
    proceeds: text(proceeds),
    income: text(income),
    charges: text(charges),
    contributed: text(contributed),
    market: text(market),
    result: text(result),
    share:
      compareExact(atWork, ZERO) > 0
        ? text(over(result, atWork))
        : result.n === 0n
          ? "0"
          : null,
  };
}

// Periods' returns one after another as one: each grows what the last left.
// Null when one of them is unknown.
export function chainedShare(
  shares: readonly (string | null)[],
): string | null {
  let grown = ONE;
  for (const share of shares) {
    if (share === null) return null;
    grown = times(grown, plus(ONE, exactOf(share)));
  }
  return text(minus(grown, ONE));
}
