import type {
  QuoteBatch,
  QuoteSource,
  RawQuoteRows,
  SavedCounts,
} from "./quote";

// One public quote source. read() returns the rows it could check; it throws a
// QuoteFeedError when the source fails, or a bug's own error.
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

// The store the composition root injects; resolves with the rows actually
// inserted and throws QuoteSaveError.
export type SaveQuotes = (batch: QuoteBatch) => Promise<SavedCounts>;
