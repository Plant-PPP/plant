import {
  addDays,
  type Currency,
  daysBetween,
  type Exact,
  exactOf,
  over,
  roundedTo,
  stored,
  times,
} from "@plant/shared";

import { quantityOn } from "../movements/admit";
import type { Movement } from "../movements/movement";

// A payment a holding is expected to make: its kind, its day and its gross
// amount in the currency it pays in.
export type UpcomingIncome = {
  kind: "dividend" | "coupon";
  date: string;
  currency: Currency;
  amount: string;
};

type Paid = Extract<Movement, { kind: "dividend" | "coupon" }>;

const isPaid = (movement: Movement): movement is Paid =>
  movement.kind === "dividend" || movement.kind === "coupon";

// The middle gap between consecutive payments, in days.
function typicalGap(paid: readonly Paid[]): number {
  const gaps = paid
    .slice(1)
    .map((each, index) => daysBetween(paid[index]!.date, each.date))
    .sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)]!;
}

// How a holding has been paying: the kind and currency of its last payment,
// its day, the typical gap between payments and what it paid per unit. A
// holding that paid fewer than twice, held no units at its last payment, or
// skipped two payments in a row has no pattern.
export type IncomePattern = {
  kind: UpcomingIncome["kind"];
  currency: Currency;
  last: string;
  gap: number;
  perUnit: Exact;
};

export function incomePattern(
  movements: readonly Movement[],
  today: string,
): IncomePattern | null {
  const paid = movements.filter(isPaid).filter((each) => each.date <= today);
  if (paid.length < 2) return null;
  const last = paid.at(-1)!;
  const gap = typicalGap(paid);
  if (gap <= 0 || daysBetween(last.date, today) > 2 * gap) return null;
  const heldThen = exactOf(quantityOn(movements, last.date));
  if (heldThen.n <= 0n) return null;
  return {
    kind: last.kind,
    currency: last.currency,
    last: last.date,
    gap,
    perUnit: over(exactOf(last.amount), heldThen),
  };
}

// The payments `held` units are expected to make after `today` and up to
// `days` later on a pattern: one every typical gap after the last, each what
// the last paid per unit times the units.
export function upcomingFrom(
  pattern: IncomePattern | null,
  held: string,
  today: string,
  days: number,
): UpcomingIncome[] {
  const units = exactOf(held);
  if (!pattern || units.n <= 0n) return [];
  const amount = stored(roundedTo(times(pattern.perUnit, units), 2));
  const until = addDays(today, days);
  const upcoming: UpcomingIncome[] = [];
  for (
    let date = addDays(pattern.last, pattern.gap);
    date <= until;
    date = addDays(date, pattern.gap)
  ) {
    if (date > today) {
      upcoming.push({
        kind: pattern.kind,
        date,
        currency: pattern.currency,
        amount,
      });
    }
  }
  return upcoming;
}
