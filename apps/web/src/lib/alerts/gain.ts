import { type Denominator, referenceUnit } from "@plant/core";
import {
  type Currency,
  exactOf,
  minus,
  over,
  plus,
  stored,
  sumOrNull,
  times,
} from "@plant/shared";

import { averageOf } from "@/lib/holdings/cost-totals";
import { allRows, type Ledger, positionsOf } from "@/lib/ledger/ledger";

import type { PriceAlert } from "./alerts";

// The unit a cost in a currency is worked out in: pesos as pesos, euros as
// euros, dollars at face value in the reference dollar's unit.
const unitOf = (currency: Currency, ledger: Ledger): Denominator =>
  currency === "ARS"
    ? "ars"
    : currency === "EUR"
      ? "eur"
      : referenceUnit(ledger.referenceDollar);

// The average cost per unit of what the user holds of an instrument, in a
// currency, from its open lots (FIFO); null when they hold none or a lot's
// cost has no value in that currency.
export function averageCost(
  ledger: Ledger,
  symbol: string,
  currency: Currency,
): string | null {
  const positions = positionsOf(ledger, unitOf(currency, ledger));
  const held = allRows(ledger).flatMap((row) => {
    if (row.holding.instrument_symbol !== symbol) return [];
    const position = positions.get(row.id);
    // A holding sold out holds no lot, whatever its history cost.
    return position && exactOf(position.quantity).n !== 0n ? [position] : [];
  });
  if (held.length === 0) return null;
  const cost = sumOrNull(held.map((each) => each.money?.cost ?? null));
  const quantity = sumOrNull(held.map((each) => each.quantity));
  if (cost === null || quantity === null) return null;
  const average = averageOf(cost, quantity);
  return average !== null && exactOf(average).n > 0n ? average : null;
}

// The instruments the user holds, by symbol, each with the currency it is
// quoted in: what an instrument's alert can watch, in pesos or dollars.
export function heldInstruments(
  ledger: Ledger,
): { symbol: string; currency: "ARS" | "USD" }[] {
  const closed = new Set(
    ledger.holdings
      .filter((each) => each.closed)
      .map((each) => each.holding.id),
  );
  const symbols = new Set(
    allRows(ledger).flatMap((row) =>
      row.holding.asset_class === "instrument" &&
      row.holding.instrument_symbol &&
      !closed.has(row.id)
        ? [row.holding.instrument_symbol]
        : [],
    ),
  );
  return ledger.instruments
    .flatMap(({ symbol, currency }) =>
      symbols.has(symbol) && currency !== "EUR" ? [{ symbol, currency }] : [],
    )
    .sort((a, b) => a.symbol.localeCompare(b.symbol));
}

// The price that meets a gain alert: the cost moved up (above) or down
// (below) by the percent.
export function gainThreshold(
  cost: string,
  direction: PriceAlert["direction"],
  percent: string,
): string {
  const share = over(exactOf(percent), exactOf("100"));
  const factor =
    direction === "above"
      ? plus(exactOf("1"), share)
      : minus(exactOf("1"), share);
  return stored(times(exactOf(cost), factor));
}

// The alerts with each waiting gain alert's figure worked out from the
// ledger as it is: what the prototype shows in place of the stored figures.
export const withGainFigures = (
  ledger: Ledger,
  alerts: readonly PriceAlert[],
): PriceAlert[] =>
  alerts.map((alert) => {
    if (alert.gainPercent === null || alert.metOn !== null) return alert;
    const figure = gainFigure(ledger, {
      ...alert,
      gainPercent: alert.gainPercent,
    });
    return {
      ...alert,
      threshold: figure?.threshold ?? null,
      costPrice: figure?.costPrice ?? null,
    };
  });

// A gain alert's figure as of the user's movements now: its cost and the
// price that meets it, or none while the cost is unknown.
export function gainFigure(
  ledger: Ledger,
  alert: Pick<PriceAlert, "subject" | "currency" | "direction"> & {
    gainPercent: string;
  },
): { costPrice: string; threshold: string } | null {
  const cost = averageCost(ledger, alert.subject, alert.currency);
  if (cost === null) return null;
  const threshold = gainThreshold(cost, alert.direction, alert.gainPercent);
  // A price numeric(20, 8) holds, above zero.
  return /^\d{1,12}(\.\d{1,8})?$/.test(threshold) && exactOf(threshold).n > 0n
    ? { costPrice: cost, threshold }
    : null;
}
