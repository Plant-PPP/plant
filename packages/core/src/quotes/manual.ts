import { currencySchema, positiveDecimalSchema } from "@plant/shared";
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

// The snapshot with the user's latest manual price on or before its date for
// each symbol, where the feeds have none or an older one: a price the user
// states wins on its day, and every day after until the feeds bring a newer
// one. With the date of each manual price it took.
export function withManualPrices(
  snapshot: QuoteSnapshot,
  manual: readonly ManualPrice[],
): { snapshot: QuoteSnapshot; manual: ReadonlyMap<string, string> } {
  const latest = new Map<string, ManualPrice>();
  for (const row of manual) {
    if (row.price_date > snapshot.date) continue;
    const kept = latest.get(row.symbol);
    if (!kept || kept.price_date < row.price_date) latest.set(row.symbol, row);
  }
  const prices = { ...snapshot.prices };
  const taken = new Map<string, string>();
  for (const row of latest.values()) {
    const fed = snapshot.prices[row.symbol];
    if (fed && fed.date > row.price_date) continue;
    prices[row.symbol] = {
      price: row.price,
      currency: row.currency,
      date: row.price_date,
    };
    taken.set(row.symbol, row.price_date);
  }
  return { snapshot: { ...snapshot, prices }, manual: taken };
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
export const MANUAL_RATE_KINDS = ["mep", "ccl", "official"] as const;
export type ManualRateKind = (typeof MANUAL_RATE_KINDS)[number];

export const manualRateSchema = z
  .object({
    kind: z.enum(MANUAL_RATE_KINDS),
    rate_date: holdingDateSchema,
    sell: positiveDecimalSchema,
  })
  .strict();
export type ManualRate = z.output<typeof manualRateSchema>;

// The snapshot with the user's latest rate of each kind on or before its
// date, where the feeds have none or an older one, as manual prices take
// theirs; with the date of each rate it took.
export function withManualRates(
  snapshot: QuoteSnapshot,
  manual: readonly ManualRate[],
): { snapshot: QuoteSnapshot; manual: ReadonlyMap<ManualRateKind, string> } {
  const latest = new Map<ManualRateKind, ManualRate>();
  for (const row of manual) {
    if (row.rate_date > snapshot.date) continue;
    const kept = latest.get(row.kind);
    if (!kept || kept.rate_date < row.rate_date) latest.set(row.kind, row);
  }
  const fx = { ...snapshot.fx };
  const taken = new Map<ManualRateKind, string>();
  for (const row of latest.values()) {
    const fed = snapshot.fx[row.kind];
    if (fed && fed.date > row.rate_date) continue;
    fx[row.kind] = { sell: row.sell, date: row.rate_date };
    taken.set(row.kind, row.rate_date);
  }
  return { snapshot: { ...snapshot, fx }, manual: taken };
}

export type ManualPriceRefusal = "future_date";

export const admitManualPrice = (
  price: ManualPrice,
  today: string,
): { ok: true } | { ok: false; code: ManualPriceRefusal } =>
  price.price_date > today ? { ok: false, code: "future_date" } : { ok: true };
