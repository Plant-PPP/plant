import type { Holding } from "@plant/core";
import type { Currency } from "@plant/shared";

import { ASSET_CLASS_LABELS } from "./messages";

// Each instrument's name by its symbol.
export function instrumentNames(
  instruments: readonly { symbol: string; name: string }[],
): ReadonlyMap<string, string> {
  return new Map(instruments.map(({ symbol, name }) => [symbol, name]));
}

// An instrument's currency, which a new movement starts in; ARS until one
// is chosen.
export const currencyOf = (
  instruments: readonly { symbol: string; currency: Currency }[],
  symbol: string,
): Currency =>
  instruments.find((each) => each.symbol === symbol)?.currency ?? "ARS";

// An instrument as lists name it: "BTC · Bitcoin", or its symbol alone.
export const instrumentLabel = (symbol: string, name?: string): string =>
  name ? `${symbol} · ${name}` : symbol;

// Where a holding is: "IOL · Largo plazo".
export const holdingPlace = (row: {
  account: { institution: string };
  portfolio: { name: string };
}): string => `${row.account.institution} · ${row.portfolio.name}`;

// A holding inside a sentence, where the same instrument can sit in several
// accounts and portfolios: "BTC · Bitcoin de IOL en Largo plazo".
export const holdingInSentence = (
  row: {
    holding: Holding;
    account: { institution: string };
    portfolio: { name: string };
  },
  instrumentNames: ReadonlyMap<string, string>,
): string =>
  `${holdingName(row.holding, instrumentNames)} de ${row.account.institution} en ${row.portfolio.name}`;

// How a holding is named in a list: "BTC · Bitcoin", its label, or its class
// and currency ("Efectivo USD").
export function holdingName(
  holding: Holding,
  instrumentNames: ReadonlyMap<string, string>,
): string {
  if (holding.asset_class === "instrument") {
    const symbol = holding.instrument_symbol;
    return instrumentLabel(symbol, instrumentNames.get(symbol));
  }
  return (
    holding.label ??
    `${ASSET_CLASS_LABELS[holding.asset_class]} ${holding.currency}`
  );
}
