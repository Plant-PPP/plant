import { DENOMINATORS, type QuoteSnapshot } from "@plant/core";
import { exactOf, minus, plus, stored } from "@plant/shared";

import type { AssistantMessage, ChatUnit } from "./chat";

// The dollar an answer in a dollar unit is at: its name and today's sell
// price; none for pesos.
export function rateOf(
  unit: ChatUnit,
  snapshot: QuoteSnapshot,
): AssistantMessage["rate"] {
  const spec = DENOMINATORS[unit];
  const dollar = "fx" in spec ? snapshot.fx[spec.fx] : undefined;
  return "fx" in spec && dollar
    ? { label: spec.fx.toUpperCase(), sell: dollar.sell }
    : null;
}

// Net worth as Resumen shows it, the last close's value, and what is held as
// that figure plus what is owed, so the three add up.
export function netWorthOf(endValue: string, owed: string) {
  return {
    netWorth: endValue,
    assets: stored(plus(exactOf(endValue), exactOf(owed))),
    debts: owed,
  };
}

// Net worth as what is held, valued as Activos values it, less what is owed.
export function worthOfAssets(assets: string, owed: string) {
  return {
    netWorth: stored(minus(exactOf(assets), exactOf(owed))),
    assets,
    debts: owed,
  };
}

// What an answer names as read, in the user's words.
export const SOURCES = {
  holdings: "Tus tenencias",
  debts: "Deudas",
  quotes: "Cotizaciones",
  closes: "Cierres",
  movements: "Movimientos",
} as const;
