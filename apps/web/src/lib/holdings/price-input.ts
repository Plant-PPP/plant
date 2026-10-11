import {
  INSTRUMENT_PRICING,
  type InstrumentType,
  type ManualPriceRefusal,
  exactUnitPrice,
  quotedPrice,
} from "@plant/core";
import type { Currency } from "@plant/shared";

import {
  amountInput,
  formatPrice,
  parseAmountInput,
} from "@/lib/format/amount";

export type PriceResult =
  { ok: true } | { ok: false; code: "invalid" | "failed" | ManualPriceRefusal };

// What the price dialog holds, as typed: the price as the market quotes it.
export type PriceFields = { price: string; date: string };

// How a type's price is read: per unit, or per 100 nominal.
export const priceBasisLabel = (type: InstrumentType): string =>
  INSTRUMENT_PRICING[type].basis === 1 ? "por unidad" : "cada 100 VN";

export const priceFields = (
  type: InstrumentType,
  latest: { price: string; date: string } | null,
  today: string,
): PriceFields => ({
  price: latest ? amountInput(quotedPrice(type, latest.price)) : "",
  date: latest?.date ?? today,
});

// What the dialog sends: the price of one unit. A price the parser refuses
// goes as null, for the schema to refuse.
export function toPriceInput(
  fields: PriceFields,
  instrument: { symbol: string; currency: Currency; type: InstrumentType },
) {
  const quoted = parseAmountInput(fields.price);
  return {
    symbol: instrument.symbol,
    price_date: fields.date,
    price: quoted === null ? null : exactUnitPrice(instrument.type, quoted),
    currency: instrument.currency,
  };
}

// A unit's price as the market quotes it, in a currency or the page's unit: a
// bond's per 100 nominal. An instrument whose type the page does not know
// shows per unit.
export function formatQuotedPrice(
  perUnit: string,
  unit: Parameters<typeof formatPrice>[1],
  type: InstrumentType | null | undefined,
): string {
  if (!type || INSTRUMENT_PRICING[type].basis === 1) {
    return formatPrice(perUnit, unit);
  }
  return `${formatPrice(quotedPrice(type, perUnit), unit)} c/100 VN`;
}
