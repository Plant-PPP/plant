import type { QuoteSnapshot } from "@plant/core";
import { exactOf, minus, over, plus, stored } from "@plant/shared";

// What a peso return is set against over a period: inflation, read from the
// UVA (which CER moves with the consumer price index, about a month late),
// and the dollar, read from the MEP. Each is a fraction, null where a quote
// is missing at either end.
export type Benchmarks = { inflation: string | null; dollar: string | null };

const ONE = exactOf("1");

// How much a rate moved between two days: end over start, minus one.
function changeOf(
  start: QuoteSnapshot,
  end: QuoteSnapshot,
  kind: "uva" | "mep",
): string | null {
  const from = start.fx[kind]?.sell;
  const to = end.fx[kind]?.sell;
  if (!from || !to || exactOf(from).n === 0n) return null;
  return stored(minus(over(exactOf(to), exactOf(from)), ONE));
}

export const benchmarksBetween = (
  start: QuoteSnapshot,
  end: QuoteSnapshot,
): Benchmarks => ({
  inflation: changeOf(start, end, "uva"),
  dollar: changeOf(start, end, "mep"),
});

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
    grown = over(
      { n: grown.n * plus(ONE, exactOf(change!)).n, d: grown.d },
      { n: plus(ONE, exactOf(change!)).d, d: 1n },
    );
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
