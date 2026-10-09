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
// one beyond ±15:59, which would fail the whole insert. Postgres has no year 0
// and does not read the six-digit years toISOString writes past 9999.
const isoInstant = z.iso
  .datetime({ offset: true })
  .transform((value) => new Date(value).toISOString())
  .refine(
    (value) => /^(?!0000)\d{4}-/.test(value),
    "Must be in years 1 to 9999",
  );

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
// schemas or share their primary key with a later row.
export type QuoteBatch = {
  fxRates: FxRate[];
  prices: Price[];
  staleCount: number;
  invalidCount: number;
};

export type QuoteFeedCode =
  | "fetch_error"
  | "http_429"
  | "http_4xx"
  | "http_5xx"
  | "too_large"
  | "bad_json"
  | "bad_shape"
  | "provider_error"
  | "empty";

// The message is only the code, so no source's text reaches a log line.
export class QuoteFeedError extends Error {
  override readonly name = "QuoteFeedError";
  constructor(
    readonly code: QuoteFeedCode,
    readonly retryable: boolean,
  ) {
    super(code);
  }
}

// A response that fails its schema is not retried: the source changed shape.
export function parseResponse<T>(schema: z.ZodType<T>, json: unknown): T {
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new QuoteFeedError("bad_shape", false);
  return parsed.data;
}

// Today in Buenos Aires is the only date the quotes' insert guard accepts. UVA
// is fixed for the whole day.
export function inQuoteWindow(
  kind: FxRateKind | "price",
  date: string,
  now: Date,
): boolean {
  if (date !== buenosAiresDate(now)) return false;
  return kind === "uva" || buenosAiresHour(now) >= QUOTE_CLOSE_HOUR;
}

function lastPerKey<T>(rows: T[], key: (row: T) => string): T[] {
  return [...new Map(rows.map((row) => [key(row), row])).values()];
}

// One row per table primary key; the last one wins.
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
  const fresh = {
    fxRates: fxRates.filter((row) =>
      inQuoteWindow(row.kind, row.rate_date, now),
    ),
    prices: prices.filter((row) => inQuoteWindow("price", row.price_date, now)),
  };
  const kept = {
    fxRates: lastPerKey(fresh.fxRates, (row) => `${row.kind} ${row.rate_date}`),
    prices: lastPerKey(
      fresh.prices,
      (row) => `${row.symbol} ${row.price_date}`,
    ),
  };
  const read = fxRates.length + prices.length;
  const inWindow = fresh.fxRates.length + fresh.prices.length;
  return {
    ...kept,
    staleCount: read - inWindow,
    invalidCount:
      invalidCount + inWindow - kept.fxRates.length - kept.prices.length,
  };
}
