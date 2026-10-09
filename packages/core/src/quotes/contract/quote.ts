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

// An index fixed for the whole day, with a single value: due at any hour and
// published every day of the week. The quotes migration's
// CHECK (kind <> 'uva' OR buy IS NULL) names the same kinds.
const DAILY_INDEXES: readonly FxRateKind[] = ["uva"];
export const isDailyIndex = (kind: FxRateKind): boolean =>
  DAILY_INDEXES.includes(kind);

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
  .refine((row) => !isDailyIndex(row.kind) || row.buy === null, {
    message: "A daily index has no buying rate",
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

// Each table's primary key, as in the quotes migration. A row's key is the
// first column's value; the date is the same for every row a read keeps.
export const QUOTE_KEYS = {
  fxRates: ["kind", "rate_date"],
  prices: ["symbol", "price_date"],
} as const satisfies {
  fxRates: readonly (keyof FxRate)[];
  prices: readonly (keyof Price)[];
};

// The factory stamps source and fetched_at on every row.
export type RawFxRate = Omit<FxRate, "source" | "fetched_at">;
export type RawPrice = Omit<Price, "source" | "fetched_at">;
// unread: the parts of a source that failed while the rest answered, keyed
// like the rows they would have been.
export type RawQuoteRows = {
  fxRates: RawFxRate[];
  prices: RawPrice[];
  unread?: { key: string; code: QuoteFeedCode }[];
};

// Why a row was not kept:
// - early: read before the close hour, when nothing traded is due yet;
// - closed: the dollar market's Friday rate, read on the weekend;
// - stale: dated any other day than today;
// - invalid: failed the schemas, shares its primary key with a later kept
//   row, or was never read.
export const REFUSALS = ["early", "closed", "stale", "invalid"] as const;
export type Refusal = (typeof REFUSALS)[number];

// refused lists the key of every row not kept, so every raw row is kept or in
// exactly one bucket. unread lists each unread part as key:code.
export type QuoteBatch = {
  fxRates: FxRate[];
  prices: Price[];
  refused: Record<Refusal, string[]>;
  unread: string[];
};

// Each code with whether a retry can help.
export const QUOTE_FEED_CODES = {
  fetch_error: true,
  timeout: true,
  http_429: true,
  http_5xx: true,
  provider_busy: true,
  empty: true,
  http_4xx: false,
  too_large: false,
  bad_json: false,
  bad_shape: false,
  provider_error: false,
} as const;
export type QuoteFeedCode = keyof typeof QUOTE_FEED_CODES;

// out_of_window is the store's refusal of a date that is not today: a retry
// reads the feed again. unavailable: the store did not answer and may have
// committed.
export const QUOTE_STORE_CODES = {
  timeout: true,
  unavailable: true,
  out_of_window: true,
  forbidden: false,
  invalid_row: false,
  unconfigured: false,
  rejected: false,
} as const;
export type QuoteStoreCode = keyof typeof QUOTE_STORE_CODES;

// The message is only the code, so no provider's or store's text reaches a
// log line; retryable comes from the code.
export abstract class QuoteError<C extends string> extends Error {
  readonly retryable: boolean;
  protected constructor(
    readonly code: C,
    codes: Readonly<Record<C, boolean>>,
  ) {
    super(code);
    this.retryable = codes[code];
  }
}

export const QUOTE_FEED_ERROR_NAME = "QuoteFeedError";
export const QUOTE_STORE_ERROR_NAME = "QuoteStoreError";

export class QuoteFeedError extends QuoteError<QuoteFeedCode> {
  override readonly name = QUOTE_FEED_ERROR_NAME;
  constructor(code: QuoteFeedCode) {
    super(code, QUOTE_FEED_CODES);
  }
}

// storeCode is the store's own bounded error code, when it gave one.
export class QuoteStoreError extends QuoteError<QuoteStoreCode> {
  override readonly name = QUOTE_STORE_ERROR_NAME;
  constructor(
    code: QuoteStoreCode,
    readonly storeCode?: string,
  ) {
    super(code, QUOTE_STORE_CODES);
  }
}

export type QuoteStage = "read" | "save";

const FAILURES: Readonly<
  Record<
    string,
    { stage: QuoteStage; codes: Readonly<Record<string, boolean>> }
  >
> = {
  [QUOTE_FEED_ERROR_NAME]: { stage: "read", codes: QUOTE_FEED_CODES },
  [QUOTE_STORE_ERROR_NAME]: { stage: "save", codes: QUOTE_STORE_CODES },
};

// A serialized error keeps only its name and message, so the stage and code
// are rebuilt from them: an unknown class is a read failure, and a message
// outside its class's codes reads as _OTHER, so the code stays bounded.
export function quoteFailureOf(error: unknown): {
  stage: QuoteStage;
  code: string;
} {
  const { name, message } =
    typeof error === "object" && error !== null
      ? (error as { name?: unknown; message?: unknown })
      : {};
  const failure =
    typeof name === "string" && Object.hasOwn(FAILURES, name)
      ? FAILURES[name]
      : undefined;
  const known =
    failure !== undefined &&
    typeof message === "string" &&
    Object.hasOwn(failure.codes, message);
  return { stage: failure?.stage ?? "read", code: known ? message : "_OTHER" };
}

// The contract's code table applied to an HTTP status, for the reader the
// composition root injects.
export function feedErrorForStatus(status: number): QuoteFeedError {
  if (status === 429) return new QuoteFeedError("http_429");
  return new QuoteFeedError(status >= 500 ? "http_5xx" : "http_4xx");
}

// A response that fails its schema is not retried: the source changed shape.
export function parseResponse<T>(schema: z.ZodType<T>, json: unknown): T {
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new QuoteFeedError("bad_shape");
  return parsed.data;
}

// The Friday before a Buenos Aires Saturday or Sunday, else null. The date is
// read as UTC midnight and only through getUTC*/setUTC*: new Date(date).getDay()
// reads the host's zone, where a Saturday can be Friday.
function weekendFriday(date: string): string | null {
  const day = new Date(`${date}T00:00:00Z`);
  const weekday = day.getUTCDay();
  if (weekday !== 0 && weekday !== 6) return null;
  day.setUTCDate(day.getUTCDate() - (weekday === 6 ? 1 : 2));
  return day.toISOString().slice(0, 10);
}

// Crypto trades every day; the dollar market closes on the weekend.
const closesOnWeekends = (kind: FxRateKind | "price"): boolean =>
  kind !== "price" && !isDailyIndex(kind);

// Today in Buenos Aires is the only date the quotes' insert guard accepts. A
// daily index is due at any hour; anything traded is due from the close hour
// on, and on the weekend Friday's dollar rate is the market's last one.
export function quoteWindow(
  kind: FxRateKind | "price",
  date: string,
  now: Date,
): "kept" | Exclude<Refusal, "invalid"> {
  const today = buenosAiresDate(now);
  if (kind !== "price" && isDailyIndex(kind)) {
    return date === today ? "kept" : "stale";
  }
  if (buenosAiresHour(now) < QUOTE_CLOSE_HOUR) return "early";
  if (date === today) return "kept";
  if (closesOnWeekends(kind) && date === weekendFriday(today)) return "closed";
  return "stale";
}

const UNKNOWN_KEY = "_unknown";

type Table<T> = {
  schema: z.ZodType<T>;
  keys: readonly [keyof T & string, ...(keyof T & string)[]];
  // The schema of the first key column, so a refused row's key is one the
  // schemas accept.
  keyField: z.ZodType;
  window: (row: T) => ReturnType<typeof quoteWindow>;
};

// Checks one table's rows in order: schema, window, then one row per primary
// key (the last one wins). Every refused row's key lands in one bucket.
function checkTable<T>(
  table: Table<T>,
  rows: readonly object[],
  stamp: { source: QuoteSource; fetched_at: string },
  refused: Record<Refusal, string[]>,
): T[] {
  const keyOf = (row: object) => {
    const value = (row as Record<string, unknown>)[table.keys[0]];
    const parsed = table.keyField.safeParse(value);
    return parsed.success ? String(parsed.data) : UNKNOWN_KEY;
  };
  const fresh: T[] = [];
  for (const row of rows) {
    const parsed = table.schema.safeParse({ ...row, ...stamp });
    if (!parsed.success) {
      refused.invalid.push(keyOf(row));
      continue;
    }
    const window = table.window(parsed.data);
    if (window === "kept") fresh.push(parsed.data);
    else refused[window].push(keyOf(parsed.data as object));
  }
  const last = new Map(
    fresh.map((row) => [
      table.keys.map((key) => String(row[key])).join(" "),
      row,
    ]),
  );
  const kept = new Set(last.values());
  for (const row of fresh) {
    if (!kept.has(row)) refused.invalid.push(keyOf(row as object));
  }
  return [...kept];
}

export function checkBatch(
  raw: RawQuoteRows,
  now: Date,
  source: QuoteSource,
): QuoteBatch {
  const stamp = { source, fetched_at: now.toISOString() };
  const refused = Object.fromEntries(
    REFUSALS.map((refusal) => [refusal, [] as string[]]),
  ) as Record<Refusal, string[]>;
  const fxRates = checkTable(
    {
      schema: fxRateSchema,
      keys: QUOTE_KEYS.fxRates,
      keyField: fxRateSchema.shape[QUOTE_KEYS.fxRates[0]],
      window: (row) => quoteWindow(row.kind, row.rate_date, now),
    },
    raw.fxRates,
    stamp,
    refused,
  );
  const prices = checkTable(
    {
      schema: priceSchema,
      keys: QUOTE_KEYS.prices,
      keyField: priceSchema.shape[QUOTE_KEYS.prices[0]],
      window: (row) => quoteWindow("price", row.price_date, now),
    },
    raw.prices,
    stamp,
    refused,
  );
  const unread = raw.unread ?? [];
  refused.invalid.push(...unread.map(({ key }) => key));
  return {
    fxRates,
    prices,
    refused,
    unread: unread.map(({ key, code }) => `${key}:${code}`),
  };
}
