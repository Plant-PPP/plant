import type { QuoteRange, QuoteReaderPort, StoredQuotes } from "@plant/core";

// Of each key's rows, those dated within the range and the latest before it.
function readKeyed<T>(
  rows: readonly T[],
  keyOf: (row: T) => string,
  dateOf: (row: T) => string,
  keys: readonly string[],
  range: QuoteRange,
): T[] {
  const named = new Set(keys);
  const inRange: T[] = [];
  const before = new Map<string, T>();
  for (const row of rows) {
    const key = keyOf(row);
    if (!named.has(key)) continue;
    const date = dateOf(row);
    if (date >= range.from && date <= range.to) inRange.push(row);
    else if (date < range.from) {
      const kept = before.get(key);
      if (!kept || dateOf(kept) < date) before.set(key, row);
    }
  }
  return [...inRange, ...before.values()];
}

// The fixtures' quotes read as the store reads them.
export function createFixtureQuoteReader(
  quotes: StoredQuotes,
): QuoteReaderPort {
  return {
    read: async (range: QuoteRange) => ({
      fxRates: readKeyed(
        quotes.fxRates,
        (row) => row.kind,
        (row) => row.rate_date,
        range.fxKinds,
        range,
      ),
      prices: readKeyed(
        quotes.prices,
        (row) => row.symbol,
        (row) => row.price_date,
        range.symbols,
        range,
      ),
    }),
  };
}
