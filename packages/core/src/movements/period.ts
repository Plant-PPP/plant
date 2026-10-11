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

// What a period made, in one unit, from what the holdings were worth at its
// start and end and the cash flows between them, each flow at the amount the
// caller gives it:
// - paidIn: purchases, opening balances and adjustments in, before charges;
// - proceeds: sales before charges, and adjustments out;
// - income: dividends and coupons before withholding;
// - charges: commissions, fees, taxes and withholding;
// - contributed: paidIn less proceeds, what the holder put in net;
// - market: the change in value not explained by what was put in or taken
//   out, from prices and the dollar alone;
// - result: market plus income less charges;
// - share: result over the money at work, each flow weighted by the part of
//   the period it was in (the modified Dietz return), so putting money in
//   is not a gain; 0 when nothing was made with nothing at work, and null
//   when the money at work is not above zero but something was made (nothing
//   at work, or a large outflow early in the period) or the loss exceeds it.
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
  // Money first put to work inside the period works from the start of that
  // day, so a first purchase on its last day counts for the whole of it.
  const firstIn =
    start.n === 0n
      ? flows
          .filter((flow) => flow.kind !== "income")
          .map((flow) => flow.date)
          .sort()[0]
      : undefined;
  const days = Math.max(
    1,
    firstIn === undefined
      ? daysBetween(from, to)
      : daysBetween(firstIn, to) + 1,
  );
  let paidIn = ZERO;
  let proceeds = ZERO;
  let income = ZERO;
  let charges = ZERO;
  // The money at work: the start value, plus each flow in for the part of
  // the period from the start of its day, less each flow out for the part
  // after the end of its day, since the money worked the day it left. An
  // income is what the money made, not money put in or taken out.
  let atWork = start;
  for (const flow of flows) {
    const amount = exactOf(flow.amount);
    const paid = exactOf(flow.charges);
    charges = plus(charges, paid);
    // What changed hands before charges: a purchase cost the flow less its
    // charges, a sale or an income brought it plus them.
    if (flow.kind === "income") {
      income = plus(income, amount, paid);
      continue;
    }
    if (flow.kind === "buy") {
      paidIn = plus(paidIn, negated(amount), negated(paid));
    } else proceeds = plus(proceeds, amount, paid);
    const weight = over(
      {
        n: BigInt(daysBetween(flow.date, to) + (flow.kind === "buy" ? 1 : 0)),
        d: 1n,
      },
      { n: BigInt(days), d: 1n },
    );
    atWork = minus(atWork, times(amount, weight));
  }
  const contributed = minus(paidIn, proceeds);
  const market = minus(minus(end, start), contributed);
  const result = minus(plus(market, income), charges);
  return {
    startValue: stored(start),
    endValue: stored(end),
    paidIn: stored(paidIn),
    proceeds: stored(proceeds),
    income: stored(income),
    charges: stored(charges),
    contributed: stored(contributed),
    market: stored(market),
    result: stored(result),
    share: shareOf(result, atWork),
  };
}

// A return no money at work could make (all of it lost and more) is not one
// the approximation can measure.
function shareOf(result: Exact, atWork: Exact): string | null {
  if (compareExact(atWork, ZERO) <= 0) return result.n === 0n ? "0" : null;
  const share = over(result, atWork);
  return compareExact(share, negated(ONE)) < 0 ? null : stored(share);
}

// Periods' returns one after another as one: each grows what the last left.
// A period with no return of its own (nothing at work) adds nothing; null
// when none of them has one.
export function chainedShare(
  shares: readonly (string | null)[],
): string | null {
  const known = shares.filter((share) => share !== null);
  if (known.length === 0 && shares.length > 0) return null;
  let grown = ONE;
  for (const share of known) {
    grown = times(grown, plus(ONE, exactOf(share)));
  }
  return stored(minus(grown, ONE));
}
