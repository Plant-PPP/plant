import {
  INSTRUMENT_PRICING,
  type InstrumentType,
  type ManualPriceRefusal,
  quotedPrice,
  unitPrice,
} from "@plant/core";
import type { Currency } from "@plant/shared";

import { amountInput, parseAmountInput } from "@/lib/format/amount";

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
    price: quoted === null ? null : unitPrice(instrument.type, quoted),
    currency: instrument.currency,
  };
}
