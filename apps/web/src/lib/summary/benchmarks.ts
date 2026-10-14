import { QUOTE_CARRY_DAYS, type QuoteSnapshot } from "@plant/core";
import {
  addDays,
  exactOf,
  minus,
  over,
  plus,
  stored,
  times,
} from "@plant/shared";

// What a peso return is set against over a period: inflation, read from the
// UVA (which CER moves with the consumer price index, about a month late),
// and the dollar, read from the MEP. Each is a fraction, null where a quote
// is missing at either end.
export type Benchmarks = { inflation: string | null; dollar: string | null };

const ONE = exactOf("1");

// A rate of the day, or none when the one at hand is older than a quote
// carries: a manual rate of long ago would make a month look flat, or jump.
function rateOn(
  snapshot: QuoteSnapshot,
  day: string,
  kind: "uva" | "mep",
): string | null {
  const rate = snapshot.fx[kind];
  if (!rate || rate.date < addDays(day, -QUOTE_CARRY_DAYS)) return null;
  return rate.sell;
}

// How much a rate moved between two days: end over start, minus one.
function changeOf(
  start: { day: string; snapshot: QuoteSnapshot },
  end: { day: string; snapshot: QuoteSnapshot },
  kind: "uva" | "mep",
): string | null {
  const from = rateOn(start.snapshot, start.day, kind);
  const to = rateOn(end.snapshot, end.day, kind);
  if (!from || !to || exactOf(from).n === 0n) return null;
  return stored(minus(over(exactOf(to), exactOf(from)), ONE));
}

export const benchmarksBetween = (
  start: { day: string; snapshot: QuoteSnapshot },
  end: { day: string; snapshot: QuoteSnapshot },
): Benchmarks => ({
  inflation: changeOf(start, end, "uva"),
  dollar: changeOf(start, end, "mep"),
});

export const NO_BENCHMARKS: Benchmarks = { inflation: null, dollar: null };

// Consecutive periods' changes as one; null when any of them is unknown, so
// a year never claims a figure for months it could not measure.
export function chainedChange(
  changes: readonly (string | null)[],
): string | null {
  if (changes.length === 0 || changes.some((each) => each === null)) {
    return null;
  }
  let grown = ONE;
  for (const change of changes) {
    grown = times(grown, plus(ONE, exactOf(change!)));
  }
  return stored(minus(grown, ONE));
}

// A return set against a benchmark's change: what it grew beyond it, as
// (1 + return) / (1 + change) - 1. A real return beats inflation above 0.
export function beyond(
  share: string | null,
  change: string | null,
): string | null {
  if (share === null || change === null) return null;
  const base = plus(ONE, exactOf(change));
  if (base.n <= 0n) return null;
  return stored(minus(over(plus(ONE, exactOf(share)), base), ONE));
}
