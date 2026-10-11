import { type Exact, plus, toDecimal } from "@plant/shared";
import type { QuoteNeed, QuoteSnapshot } from "../quotes/contract/quote";
import { type ReferenceDollar, express } from "./denominator";
import {
  DENOMINATORS,
  type Denominator,
  type DenominatorSpec,
  UNIT_FX_KINDS,
} from "./denominators";
import { type Holding, valueHolding } from "./holding";

export type HoldingsValue = {
  // Rounded once from exactTotal, to the denominator's scale.
  total: string;
  exactTotal: Exact;
  // False when a holding had no quote; it is listed and left out of the total.
  complete: boolean;
  missing: string[];
  items: {
    id: string;
    // Rounded on its own, so items can differ from the total by the rounding.
    value: string | null;
    asOf: string | null;
    state?: "matured" | "not_started";
    missing?: string;
  }[];
};

// The caller passes active holdings; this values them, in one portfolio or all
// of them, in one unit. A past snapshot values today's holdings at that day's
// quotes.
export function valueHoldings(
  holdings: readonly Holding[],
  snapshot: QuoteSnapshot,
  {
    denominator,
    referenceDollar,
    portfolioId,
  }: {
    denominator: Denominator;
    referenceDollar: ReferenceDollar;
    portfolioId?: string;
  },
): HoldingsValue {
  const { scale } = DENOMINATORS[denominator];
  const items: HoldingsValue["items"] = [];
  const amounts: Exact[] = [];
  const missing: string[] = [];
  for (const holding of holdings) {
    if (portfolioId !== undefined && holding.portfolio_id !== portfolioId) {
      continue;
    }
    const held = valueHolding(holding, snapshot);
    const shown =
      "missing" in held
        ? held
        : express(
            held.money,
            held.asOf,
            denominator,
            snapshot,
            referenceDollar,
          );
    if ("missing" in shown) {
      missing.push(holding.id);
      items.push({
        id: holding.id,
        value: null,
        asOf: null,
        missing: shown.missing,
      });
      continue;
    }
    amounts.push(shown.value.amount);
    items.push({
      id: holding.id,
      value: toDecimal(shown.value.amount, scale),
      asOf: shown.asOf,
      ...("state" in held && held.state && { state: held.state }),
    });
  }
  const exactTotal = plus(...amounts);
  return {
    total: toDecimal(exactTotal, scale),
    exactTotal,
    complete: missing.length === 0,
    missing,
    items,
  };
}

const SPECS: readonly DenominatorSpec[] = Object.values(DENOMINATORS);

// The quotes valuing these holdings in any unit can read: every unit's rate,
// every priced unit, and each held instrument's price.
export function quotesNeeded(holdings: readonly Holding[]): QuoteNeed {
  return {
    fxKinds: UNIT_FX_KINDS,
    symbols: [
      ...SPECS.flatMap((spec) => ("priced" in spec ? [spec.priced] : [])),
      ...holdings.flatMap((holding) =>
        holding.asset_class === "instrument" ? [holding.instrument_symbol] : [],
      ),
    ],
  };
}
