import type {
  FxRate,
  Price,
  QuoteBatch,
  QuoteNeed,
  QuoteSource,
  RawQuoteRows,
} from "./quote";

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
// code says whether a retry can help (QUOTE_FEED_CODES in quote.ts). maxBytes
// raises the reader's body cap for an answer known to be larger.
export type GetJsonOptions = {
  headers?: Readonly<Record<string, string>>;
  maxBytes?: number;
};
export type GetJson = (
  url: string,
  options?: GetJsonOptions,
) => Promise<unknown>;

// A form POST read as JSON, with GetJson's errors.
export type PostForm = (
  url: string,
  form: Readonly<Record<string, string>>,
) => Promise<unknown>;

export type QuoteRows = Pick<QuoteBatch, "fxRates" | "prices">;
// The rows this call inserted; a row already stored counts 0.
export type SavedCounts = { fxRates: number; prices: number };

// Where the quotes job saves what the feeds kept, implemented by the
// composition root. save() throws a QuoteStoreError, whose code says whether a
// retry can help.
export interface QuoteStorePort {
  save(rows: QuoteRows): Promise<SavedCounts>;
}

// The stored quotes for every key a need names, dated from `from` to `to`
// inclusive (YYYY-MM-DD).
export type QuoteRange = QuoteNeed & { from: string; to: string };
export type StoredQuotes = {
  fxRates: Pick<FxRate, "kind" | "rate_date" | "sell">[];
  prices: Pick<Price, "symbol" | "price_date" | "price" | "currency">[];
};

// Where a valuation reads saved quotes, implemented by the composition root.
// read() rejects with a QuoteStoreError when the store fails; any other error
// is a bug and passes through unchanged.
export interface QuoteReaderPort {
  read(range: QuoteRange): Promise<StoredQuotes>;
}
