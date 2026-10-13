import { addDays, daysBetween, positiveDecimalSchema } from "@plant/shared";
import type {
  QuoteRange,
  QuoteReaderPort,
  StoredQuotes,
} from "./contract/port";
import type { QuoteNeed, QuoteSnapshot } from "./contract/quote";

// How many days a saved quote stands in for the days after it: a long weekend
// plus holidays, never a stale rate weeks old.
export const QUOTE_CARRY_DAYS = 7;

export type SnapshotRead = { snapshot: QuoteSnapshot; invalidCount: number };

function rangeOf(date: string, need: QuoteNeed): QuoteRange {
  return {
    from: addDays(date, -QUOTE_CARRY_DAYS),
    to: date,
    fxKinds: [...new Set(need.fxKinds)].sort(),
    symbols: [...new Set(need.symbols)].sort(),
  };
}

const isValid = (amount: string): boolean =>
  positiveDecimalSchema.safeParse(amount).success;

// Each key's latest row inside the range, whatever order the rows came in. A
// row whose amount fails the decimal check is dropped and counted.
export function snapshotFromRows(
  range: QuoteRange,
  rows: StoredQuotes,
): SnapshotRead {
  const inRange = (date: string) => date >= range.from && date <= range.to;
  const kinds = new Set<string>(range.fxKinds);
  const symbols = new Set(range.symbols);
  const fx: QuoteSnapshot["fx"] = {};
  const prices: QuoteSnapshot["prices"] = {};
  let invalidCount = 0;
  for (const row of rows.fxRates) {
    if (!kinds.has(row.kind) || !inRange(row.rate_date)) continue;
    if (!isValid(row.sell)) {
      invalidCount += 1;
      continue;
    }
    const kept = fx[row.kind];
    if (!kept || kept.date < row.rate_date) {
      fx[row.kind] = { sell: row.sell, date: row.rate_date };
    }
  }
  for (const row of rows.prices) {
    if (!symbols.has(row.symbol) || !inRange(row.price_date)) {
      continue;
    }
    if (!isValid(row.price)) {
      invalidCount += 1;
      continue;
    }
    const kept = prices[row.symbol];
    if (!kept || kept.date < row.price_date) {
      prices[row.symbol] = {
        price: row.price,
        currency: row.currency,
        date: row.price_date,
      };
    }
  }
  return { snapshot: { date: range.to, fx, prices }, invalidCount };
}

// The snapshot for a day from rows already read: every row the store would
// return for that day's range, or more.
export const snapshotOn = (
  rows: StoredQuotes,
  date: string,
  need: QuoteNeed,
): SnapshotRead => snapshotFromRows(rangeOf(date, need), rows);

// The snapshot for a day, read through the store. Rejects with what the
// reader rejects with.
export async function readSnapshot(
  reader: QuoteReaderPort,
  date: string,
  need: QuoteNeed,
): Promise<SnapshotRead> {
  const range = rangeOf(date, need);
  return snapshotFromRows(range, await reader.read(range));
}

// The longest range one read of readQuotesOn covers, so a read of every
// dollar kind stays far under the store's row cap, and how many of its reads
// run at once.
export const QUOTES_ON_SPAN_DAYS = 31;
export const QUOTES_ON_CONCURRENCY = 6;

// Every stored row the snapshot of each of `dates` reads, in as few reads as
// the dates allow: days whose ranges overlap share one read, up to
// QUOTES_ON_SPAN_DAYS. snapshotOn picks each day's snapshot from the result.
export async function readQuotesOn(
  reader: QuoteReaderPort,
  dates: readonly string[],
  need: QuoteNeed,
): Promise<StoredQuotes> {
  const ranges: QuoteRange[] = [];
  for (const date of [...new Set(dates)].sort()) {
    const range = rangeOf(date, need);
    const last = ranges.at(-1);
    if (
      last &&
      range.from <= last.to &&
      daysBetween(last.from, date) < QUOTES_ON_SPAN_DAYS
    ) {
      last.to = date;
    } else ranges.push(range);
  }
  const reads: StoredQuotes[] = [];
  for (let start = 0; start < ranges.length; start += QUOTES_ON_CONCURRENCY) {
    reads.push(
      ...(await Promise.all(
        ranges
          .slice(start, start + QUOTES_ON_CONCURRENCY)
          .map((range) => reader.read(range)),
      )),
    );
  }
  return {
    fxRates: reads.flatMap((read) => read.fxRates),
    prices: reads.flatMap((read) => read.prices),
  };
}
