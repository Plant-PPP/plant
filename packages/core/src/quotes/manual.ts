import { currencySchema, positiveDecimalSchema } from "@plant/shared";
import { z } from "zod";

import { holdingDateSchema } from "../valuation/holding";
import { SYMBOL_PATTERN, type QuoteSnapshot } from "./contract/quote";

// A price the user states for an instrument the feeds do not price: per unit,
// in the instrument's currency, as of its date.
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
// each symbol the feeds left unpriced, however old, and the date of each
// manual price it took.
export function withManualPrices(
  snapshot: QuoteSnapshot,
  manual: readonly ManualPrice[],
): { snapshot: QuoteSnapshot; manual: ReadonlyMap<string, string> } {
  const latest = new Map<string, ManualPrice>();
  for (const row of manual) {
    if (snapshot.prices[row.symbol] || row.price_date > snapshot.date) continue;
    const kept = latest.get(row.symbol);
    if (!kept || kept.price_date < row.price_date) latest.set(row.symbol, row);
  }
  const prices = { ...snapshot.prices };
  for (const row of latest.values()) {
    prices[row.symbol] = {
      price: row.price,
      currency: row.currency,
      date: row.price_date,
    };
  }
  return {
    snapshot: { ...snapshot, prices },
    manual: new Map(
      [...latest].map(([symbol, row]) => [symbol, row.price_date]),
    ),
  };
}

// Where a symbol's price comes from in a snapshot `withManualPrices` built.
export function priceSource(
  symbol: string,
  priced: { snapshot: QuoteSnapshot; manual: ReadonlyMap<string, string> },
): PriceSource {
  if (priced.manual.has(symbol)) return "manual";
  return priced.snapshot.prices[symbol] ? "feed" : "missing";
}

// A feed price is never overridden: the user states one only where the feeds
// have none.
export const acceptsManualPrice = (
  symbol: string,
  priced: { snapshot: QuoteSnapshot; manual: ReadonlyMap<string, string> },
): boolean => priceSource(symbol, priced) !== "feed";

export type ManualPriceRefusal = "future_date";

export const admitManualPrice = (
  price: ManualPrice,
  today: string,
): { ok: true } | { ok: false; code: ManualPriceRefusal } =>
  price.price_date > today ? { ok: false, code: "future_date" } : { ok: true };
