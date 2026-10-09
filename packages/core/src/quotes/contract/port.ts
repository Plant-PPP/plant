import type { QuoteBatch, QuoteSource, RawQuoteRows } from "./quote";

// One public quote source. read() returns the rows that passed the check, with
// the key of every refused row. It throws a QuoteFeedError when the source
// fails; any other error is a bug and passes through unchanged.
export interface QuoteFeedPort {
  readonly id: QuoteSource;
  read(now: Date): Promise<QuoteBatch>;
}

// What an adapter hands the factory, before any row is checked.
export interface RawQuoteFeed {
  readonly id: QuoteSource;
  readRaw(now: Date): Promise<RawQuoteRows>;
}

// The HTTP reader the composition root injects. It throws QuoteFeedError, whose
// code says whether a retry can help (QUOTE_FEED_CODES in quote.ts).
export type GetJson = (url: string) => Promise<unknown>;

export type QuoteRows = Pick<QuoteBatch, "fxRates" | "prices">;
// The rows this call inserted; a row already stored counts 0.
export type SavedCounts = { fxRates: number; prices: number };

// Where the quotes job saves what the feeds kept, implemented by the
// composition root. save() throws a QuoteStoreError, whose code says whether a
// retry can help.
export interface QuoteStorePort {
  save(rows: QuoteRows): Promise<SavedCounts>;
}
