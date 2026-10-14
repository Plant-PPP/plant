import { addDays, daysBetween, positiveDecimalSchema } from "@plant/shared";
import type {
  QuoteRange,
  QuoteReaderPort,
  StoredQuotes,
} from "./contract/port";
import type { FeedDates, QuoteNeed, QuoteSnapshot } from "./contract/quote";

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
// row whose amount fails the decimal check is dropped and counted. Every row
// on or before the range's end, inside it or not, dates its key in feedDates.
export function snapshotFromRows(
  range: QuoteRange,
  rows: StoredQuotes,
): SnapshotRead {
  const inRange = (date: string) => date >= range.from && date <= range.to;
  const kinds = new Set<string>(range.fxKinds);
  const symbols = new Set(range.symbols);
  const fx: QuoteSnapshot["fx"] = {};
  const prices: QuoteSnapshot["prices"] = {};
  const feedDates: FeedDates = { fx: {}, prices: {} };
  let invalidCount = 0;
  for (const row of rows.fxRates) {
    if (!kinds.has(row.kind) || row.rate_date > range.to) continue;
    const fed = feedDates.fx[row.kind];
    if (!fed || fed < row.rate_date) feedDates.fx[row.kind] = row.rate_date;
    if (!inRange(row.rate_date)) continue;
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
    if (!symbols.has(row.symbol) || row.price_date > range.to) continue;
    const fed = feedDates.prices[row.symbol];
    if (!fed || fed < row.price_date) {
      feedDates.prices[row.symbol] = row.price_date;
    }
    if (!inRange(row.price_date)) continue;
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
  return {
    snapshot: { date: range.to, fx, prices, feedDates },
    invalidCount,
  };
}

// Each key's stored dates, oldest first, so feedDatesOn finds a day's
// feedDates without walking every row.
export type FeedDays = {
  fx: ReadonlyMap<string, readonly string[]>;
  prices: ReadonlyMap<string, readonly string[]>;
};

function datesByKey(
  rows: readonly { key: string; date: string }[],
): Map<string, string[]> {
  const byKey = new Map<string, string[]>();
  for (const { key, date } of rows) {
    const dates = byKey.get(key);
    if (dates) dates.push(date);
    else byKey.set(key, [date]);
  }
  for (const dates of byKey.values()) dates.sort();
  return byKey;
}

export const feedDaysOf = (rows: StoredQuotes): FeedDays => ({
  fx: datesByKey(
    rows.fxRates.map((row) => ({ key: row.kind, date: row.rate_date })),
  ),
  prices: datesByKey(
    rows.prices.map((row) => ({ key: row.symbol, date: row.price_date })),
  ),
});

function lastOnOrBefore(
  dates: readonly string[] | undefined,
  date: string,
): string | undefined {
  if (!dates) return undefined;
  let low = 0;
  let high = dates.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (dates[middle]! <= date) low = middle + 1;
    else high = middle;
  }
  return low > 0 ? dates[low - 1] : undefined;
}

// The feedDates snapshotOn gives `date` from the rows `days` was built from.
export function feedDatesOn(
  days: FeedDays,
  date: string,
  need: QuoteNeed,
): FeedDates {
  const feedDates: FeedDates = { fx: {}, prices: {} };
  for (const kind of need.fxKinds) {
    const fed = lastOnOrBefore(days.fx.get(kind), date);
    if (fed) feedDates.fx[kind] = fed;
  }
  for (const symbol of need.symbols) {
    const fed = lastOnOrBefore(days.prices.get(symbol), date);
    if (fed) feedDates.prices[symbol] = fed;
  }
  return feedDates;
}

// The snapshot for a day from rows already read: every row the store would
// return for that day's range, or more. In place of the latest row the store
// returns before the range, any rows that include the latest one on or before
// the day do; readQuotesOn's do.
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
