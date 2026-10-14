import {
  Constants,
  type Currency,
  currencySchema,
  positiveDecimalSchema,
} from "@plant/shared";
import { z } from "zod";

import { holdingDateSchema } from "../valuation/holding";
import { SYMBOL_PATTERN, type QuoteSnapshot } from "./contract/quote";

// A price the user states for an instrument: per unit, in the instrument's
// currency, as of its date.
export const manualPriceSchema = z
  .object({
    symbol: z.string().regex(SYMBOL_PATTERN),
    price_date: holdingDateSchema,
    price: positiveDecimalSchema,
    currency: currencySchema,
  })
  .strict();
export type ManualPrice = z.output<typeof manualPriceSchema>;

export type PriceSource = "feed" | "manual" | "missing";

// Each key's latest manual value on or before the snapshot's date, unless the
// feeds stored a newer quote for the key: a value the user states wins on its
// day, and every day after until a newer feed quote, even one past
// QUOTE_CARRY_DAYS that values nothing. With the date of each manual value it
// took.
function withManual<K extends string, M extends K, Q extends { date: string }>(
  date: string,
  fed: Partial<Record<K, Q>>,
  fedOn: Partial<Record<K, string>> | undefined,
  manual: readonly { key: M; quote: Q }[],
): { quotes: Partial<Record<K, Q>>; taken: Map<M, string> } {
  const latest = new Map<M, Q>();
  for (const { key, quote } of manual) {
    if (quote.date > date) continue;
    const kept = latest.get(key);
    if (!kept || kept.date < quote.date) latest.set(key, quote);
  }
  const quotes = { ...fed };
  const taken = new Map<M, string>();
  for (const [key, quote] of latest) {
    const feed = fedOn?.[key] ?? fed[key]?.date;
    if (feed && feed > quote.date) continue;
    quotes[key] = quote;
    taken.set(key, quote.date);
  }
  return { quotes, taken };
}

export function withManualPrices(
  snapshot: QuoteSnapshot,
  manual: readonly ManualPrice[],
): { snapshot: QuoteSnapshot; manual: ReadonlyMap<string, string> } {
  const { quotes, taken } = withManual(
    snapshot.date,
    snapshot.prices,
    snapshot.feedDates?.prices,
    manual.map((row) => ({
      key: row.symbol,
      quote: { price: row.price, currency: row.currency, date: row.price_date },
    })),
  );
  return { snapshot: { ...snapshot, prices: quotes }, manual: taken };
}

// Where a symbol's price comes from in a snapshot `withManualPrices` built.
export function priceSource(
  symbol: string,
  priced: { snapshot: QuoteSnapshot; manual: ReadonlyMap<string, string> },
): PriceSource {
  if (priced.manual.has(symbol)) return "manual";
  return priced.snapshot.prices[symbol] ? "feed" : "missing";
}

// A dollar rate the user states, as of its date: the selling rate, in pesos.
export const MANUAL_RATE_KINDS = Constants.public.Enums.manual_rate_kind;
export type ManualRateKind = (typeof MANUAL_RATE_KINDS)[number];

export const manualRateSchema = z
  .object({
    kind: z.enum(MANUAL_RATE_KINDS),
    rate_date: holdingDateSchema,
    sell: positiveDecimalSchema,
  })
  .strict();
export type ManualRate = z.output<typeof manualRateSchema>;

export function withManualRates(
  snapshot: QuoteSnapshot,
  manual: readonly ManualRate[],
): { snapshot: QuoteSnapshot; manual: ReadonlyMap<ManualRateKind, string> } {
  const { quotes, taken } = withManual(
    snapshot.date,
    snapshot.fx,
    snapshot.feedDates?.fx,
    manual.map((row) => ({
      key: row.kind,
      quote: { sell: row.sell, date: row.rate_date },
    })),
  );
  return { snapshot: { ...snapshot, fx: quotes }, manual: taken };
}

export type ManualPriceRefusal = "future_date" | "invalid";

// A price in another currency than its instrument's would value its holdings
// in the wrong one; with no instrument (undefined) there is none to price.
export function admitManualPrice(
  price: ManualPrice,
  today: string,
  instrumentCurrency: Currency | undefined,
): { ok: true } | { ok: false; code: ManualPriceRefusal } {
  if (price.currency !== instrumentCurrency) {
    return { ok: false, code: "invalid" };
  }
  return price.price_date > today
    ? { ok: false, code: "future_date" }
    : { ok: true };
}
