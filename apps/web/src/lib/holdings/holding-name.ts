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

// How a holding is named in a list: "BTC · Bitcoin", its label, or its class
// and currency ("Efectivo USD").
export function holdingName(
  holding: Holding,
  instrumentNames: ReadonlyMap<string, string>,
): string {
  if (holding.asset_class === "instrument") {
    const symbol = holding.instrument_symbol;
    const name = instrumentNames.get(symbol);
    return name ? `${symbol} · ${name}` : symbol;
  }
  return (
    holding.label ??
    `${ASSET_CLASS_LABELS[holding.asset_class]} ${holding.currency}`
  );
}
