import {
  INSTRUMENT_PRICING,
  type InstrumentType,
  type ManualPriceRefusal,
  exactUnitPrice,
  isTrade,
  type Movement,
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
  price: latest ? quotedInput(latest.price, type) : "",
  date: latest?.date ?? today,
});

// A unit's price as typed in a form: as the market quotes it, per 100
// nominal for a bond, or per unit when the type is not known.
export const quotedInput = (
  perUnit: string,
  type: InstrumentType | null | undefined,
): string => amountInput(type ? quotedPrice(type, perUnit) : perUnit);

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

// The price a movement's row shows per unit: a trade's, but not a transfer's,
// whose cost shows as its amount.
export const shownPrice = (movement: Movement): string | null =>
  isTrade(movement) && movement.kind !== "transfer" ? movement.price : null;
