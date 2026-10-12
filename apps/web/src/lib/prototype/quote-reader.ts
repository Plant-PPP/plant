import type { QuoteRange, QuoteReaderPort, StoredQuotes } from "@plant/core";

// The fixtures' quotes read as the store reads them: the rows of the range's
// kinds and symbols, dated within it.
export function createFixtureQuoteReader(
  quotes: StoredQuotes,
): QuoteReaderPort {
  return {
    read: async (range: QuoteRange) => {
      const inRange = (date: string) => date >= range.from && date <= range.to;
      return {
        fxRates: quotes.fxRates.filter(
          (row) => range.fxKinds.includes(row.kind) && inRange(row.rate_date),
        ),
        prices: quotes.prices.filter(
          (row) =>
            range.symbols.includes(row.symbol) && inRange(row.price_date),
        ),
      };
    },
  };
}
