import type { QuoteBatch, QuoteSource, RawQuoteRows } from "./quote";

// One public quote source. read() returns the rows that passed the check, with
// counts of the stale and invalid ones; it throws a QuoteFeedError when the source fails; any other error is a bug and passes
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

// The HTTP reader the composition root injects. It throws QuoteFeedError:
// fetch_error, http_429 and http_5xx are retryable; http_4xx, too_large and
// bad_json are not, and dolarapi keeps its other houses only on those.
export type GetJson = (url: string) => Promise<unknown>;
