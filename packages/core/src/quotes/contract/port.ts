import type { QuoteBatch, QuoteSource, RawQuoteRows } from "./quote";

// One public quote source. read() returns the rows it could check; it throws a
// QuoteFeedError when the source fails; any other error is a bug and passes
// through unchanged.
export interface QuoteFeedPort {
  readonly id: QuoteSource;
  read(now: Date): Promise<QuoteBatch>;
}

// What an adapter hands the factory, before any row is checked.
export interface RawQuoteFeed {
  readonly id: QuoteSource;
  readRaw(now: Date): Promise<RawQuoteRows>;
}

// The HTTP reader the composition root injects; throws QuoteFeedError.
export type GetJson = (url: string) => Promise<unknown>;
