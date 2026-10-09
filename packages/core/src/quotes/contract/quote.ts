import {
  buenosAiresDate,
  buenosAiresHour,
  compareDecimals,
  Constants,
  positiveDecimalSchema,
} from "@plant/shared";
import { z } from "zod";

const { currency, fx_rate_kind, quote_source } = Constants.public.Enums;

const quoteSourceSchema = z.enum(quote_source);
export type QuoteSource = (typeof quote_source)[number];
export type FxRateKind = (typeof fx_rate_kind)[number];

// The prices.symbol CHECK in the quotes migration uses the same pattern.
export const SYMBOL_PATTERN = /^[A-Z0-9]{1,15}$/;

// Dollar rates and prices are kept from this hour on, Buenos Aires time, so a
// day keeps its closing value; MEP and CCL close at 17:00.
export const QUOTE_CLOSE_HOUR = 18;

// Stored in UTC: a provider's stamp may carry any offset, and Postgres refuses
// one beyond ±15:59, which would fail the whole insert.
const isoInstant = z.iso
  .datetime({ offset: true })
  .transform((value) => new Date(value).toISOString());

// The object's refinements run even when a field failed; a row whose fields
// failed is already invalid, and compareDecimals expects valid decimals.
const fieldsPassed = (payload: { issues: readonly unknown[] }) =>
  payload.issues.length === 0;

const fxRateSchema = z
  .object({
    kind: z.enum(fx_rate_kind),
    rate_date: z.iso.date(),
    buy: positiveDecimalSchema.nullable(),
    sell: positiveDecimalSchema,
    source: quoteSourceSchema,
    quoted_at: isoInstant,
    fetched_at: isoInstant,
  })
  .refine(
    (row) => row.buy === null || compareDecimals(row.buy, row.sell) <= 0,
    { message: "buy must not exceed sell", when: fieldsPassed },
  )
  .refine((row) => row.kind !== "uva" || row.buy === null, {
    message: "UVA has no buying rate",
  });
export type FxRate = z.output<typeof fxRateSchema>;

const priceSchema = z.object({
  symbol: z.string().regex(SYMBOL_PATTERN),
  price_date: z.iso.date(),
  price: positiveDecimalSchema,
  currency: z.enum(currency),
  source: quoteSourceSchema,
  quoted_at: isoInstant,
  fetched_at: isoInstant,
});
export type Price = z.output<typeof priceSchema>;

export type RawFxRate = Omit<FxRate, "fetched_at">;
export type RawPrice = Omit<Price, "fetched_at">;
export type RawQuoteRows = { fxRates: RawFxRate[]; prices: RawPrice[] };

// staleCount: rows outside their window; invalidCount: rows that failed the
// schemas.
export type QuoteBatch = {
  fxRates: FxRate[];
  prices: Price[];
  staleCount: number;
  invalidCount: number;
};

export type SavedCounts = { fxRates: number; prices: number };

export const QUOTE_FEED_CODES = [
  "fetch_error",
  "http_429",
  "http_4xx",
  "http_5xx",
  "too_large",
  "bad_json",
  "bad_shape",
  "provider_error",
  "empty",
] as const;
export type QuoteFeedCode = (typeof QUOTE_FEED_CODES)[number];

export function isQuoteFeedCode(value: unknown): value is QuoteFeedCode {
  return (QUOTE_FEED_CODES as readonly unknown[]).includes(value);
}

// Both errors carry only their code as the message, so no provider or
// PostgREST text reaches a log line.
export class QuoteFeedError extends Error {
  override readonly name = "QuoteFeedError";
  constructor(
    readonly code: QuoteFeedCode,
    readonly retryable: boolean,
  ) {
    super(code);
  }
}

export const QUOTE_SAVE_CODES = [
  "timeout",
  "fetch_error",
  "http_5xx",
  "out_of_window",
  "forbidden",
  "invalid_row",
  "not_configured",
  "rejected",
] as const;
export type QuoteSaveCode = (typeof QUOTE_SAVE_CODES)[number];

export function isQuoteSaveCode(value: unknown): value is QuoteSaveCode {
  return (QUOTE_SAVE_CODES as readonly unknown[]).includes(value);
}

export class QuoteSaveError extends Error {
  override readonly name = "QuoteSaveError";
  constructor(
    readonly code: QuoteSaveCode,
    readonly retryable: boolean,
  ) {
    super(code);
  }
}

// Every row must be dated today in Buenos Aires, the only day the database
// accepts. Dollar rates and prices also wait for QUOTE_CLOSE_HOUR; UVA is
// fixed for the whole day.
export function inQuoteWindow(
  kind: FxRateKind | "price",
  date: string,
  now: Date,
): boolean {
  if (date !== buenosAiresDate(now)) return false;
  return kind === "uva" || buenosAiresHour(now) >= QUOTE_CLOSE_HOUR;
}

export function dropStale(batch: QuoteBatch, now: Date): QuoteBatch {
  const fxRates = batch.fxRates.filter((row) =>
    inQuoteWindow(row.kind, row.rate_date, now),
  );
  const prices = batch.prices.filter((row) =>
    inQuoteWindow("price", row.price_date, now),
  );
  return {
    fxRates,
    prices,
    staleCount:
      batch.staleCount +
      (batch.fxRates.length - fxRates.length) +
      (batch.prices.length - prices.length),
    invalidCount: batch.invalidCount,
  };
}

function lastPerKey<T>(rows: T[], key: (row: T) => string): T[] {
  return [...new Map(rows.map((row) => [key(row), row])).values()];
}

// Stamps each row with the read instant, drops rows that fail the schemas,
// then rows outside their window, and keeps the last row per primary key.
export function checkBatch(raw: RawQuoteRows, now: Date): QuoteBatch {
  const fetched_at = now.toISOString();
  let invalidCount = 0;
  const fxRates: FxRate[] = [];
  for (const row of raw.fxRates) {
    const parsed = fxRateSchema.safeParse({ ...row, fetched_at });
    if (parsed.success) fxRates.push(parsed.data);
    else invalidCount += 1;
  }
  const prices: Price[] = [];
  for (const row of raw.prices) {
    const parsed = priceSchema.safeParse({ ...row, fetched_at });
    if (parsed.success) prices.push(parsed.data);
    else invalidCount += 1;
  }
  const fresh = dropStale(
    { fxRates, prices, staleCount: 0, invalidCount },
    now,
  );
  return {
    ...fresh,
    fxRates: lastPerKey(fresh.fxRates, (row) => `${row.kind} ${row.rate_date}`),
    prices: lastPerKey(
      fresh.prices,
      (row) => `${row.symbol} ${row.price_date}`,
    ),
  };
}
