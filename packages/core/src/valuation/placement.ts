import {
  daysBetween,
  type Exact,
  exactOf,
  plus,
  roundedTo,
  stored,
  times,
} from "@plant/shared";

import type { Holding } from "./holding";

// A placement at a rate: a fixed term, a "caución" or a loan the user gave.
export type Placement = Extract<Holding, { asset_class: "fixed_term" }>;

type Terms = Pick<
  Placement,
  "amount" | "annual_rate" | "started_on" | "matures_on"
>;

// The interest earned from the start to `date`, or to the maturity once it is
// past: simple interest, actual/365, credited in cents.
export function interestTo(placement: Terms, date: string): Exact {
  const end = date < placement.matures_on ? date : placement.matures_on;
  if (end <= placement.started_on) return { n: 0n, d: 1n };
  return roundedTo(
    times(times(exactOf(placement.amount), exactOf(placement.annual_rate)), {
      n: BigInt(daysBetween(placement.started_on, end)),
      d: 365n,
    }),
    2,
  );
}

export type PlacementFigures = {
  // The interest earned to `today`, and the whole term's.
  accrued: string;
  atMaturity: string;
  // The capital plus the whole term's interest: what a renewal starts with.
  maturityAmount: string;
  // The term in days, and the effective annual rate the nominal one makes
  // when each term's interest is placed again, as a fraction; null for a
  // term of no days.
  days: number;
  effectiveRate: string | null;
};

// What a placement pays, to today and at its maturity.
export function placementFigures(
  placement: Terms,
  today: string,
): PlacementFigures {
  const atMaturity = interestTo(placement, placement.matures_on);
  const days = daysBetween(placement.started_on, placement.matures_on);
  return {
    accrued: stored(interestTo(placement, today)),
    atMaturity: stored(atMaturity),
    maturityAmount: stored(plus(exactOf(placement.amount), atMaturity)),
    days,
    effectiveRate: days > 0 ? effectiveRate(placement.annual_rate, days) : null,
  };
}

// (1 + TNA · days / 365) ^ (365 / days) − 1, to six decimals. A rate shown as
// a percentage, never an amount: the power with a fractional exponent is the
// one figure computed in floating point.
function effectiveRate(annualRate: string, days: number): string {
  const perTerm = 1 + (Number(annualRate) * days) / 365;
  return (perTerm ** (365 / days) - 1).toFixed(6);
}
