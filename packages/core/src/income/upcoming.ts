import {
  addDays,
  type Currency,
  daysBetween,
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

// The payments a holding is expected to make after `today` and up to `days`
// later, from what it paid before: one every typical gap after the last, each
// what the last paid per unit times the units held today. A holding that paid
// fewer than twice, holds no units, or skipped two payments in a row is
// expected to pay nothing.
export function upcomingIncome(
  movements: readonly Movement[],
  today: string,
  days: number,
): UpcomingIncome[] {
  const paid = movements.filter(isPaid).filter((each) => each.date <= today);
  if (paid.length < 2) return [];
  const last = paid.at(-1)!;
  const gap = typicalGap(paid);
  if (gap <= 0 || daysBetween(last.date, today) > 2 * gap) return [];
  const held = exactOf(quantityOn(movements, today));
  const heldThen = exactOf(quantityOn(movements, last.date));
  if (held.n <= 0n || heldThen.n <= 0n) return [];
  const amount = stored(
    roundedTo(times(over(exactOf(last.amount), heldThen), held), 2),
  );
  const until = addDays(today, days);
  const upcoming: UpcomingIncome[] = [];
  for (
    let date = addDays(last.date, gap);
    date <= until;
    date = addDays(date, gap)
  ) {
    if (date > today) {
      upcoming.push({ kind: last.kind, date, currency: last.currency, amount });
    }
  }
  return upcoming;
}
