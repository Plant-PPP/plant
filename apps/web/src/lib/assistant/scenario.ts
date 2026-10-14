import {
  type Holding,
  type Liability,
  type QuoteSnapshot,
  type ReferenceDollar,
  UNIT_FX_KINDS,
  valueHoldings,
  valueLiabilities,
} from "@plant/core";
import { exactOf, minus, over, plus, stored, times } from "@plant/shared";

import { formatShare } from "@/lib/format/amount";

import { barsOf, type ChartPart, type ChatUnit } from "./chat";
import { worthOfAssets } from "./figures";

// The dollars a scenario can move: one of them, or all three at once.
export const SCENARIO_DOLLARS = ["mep", "ccl", "official", "all"] as const;
export type ScenarioDollar = (typeof SCENARIO_DOLLARS)[number];

// A hypothetical move of the quotes: a dollar, the price of one instrument
// (or of every one, with no symbol), or both, each by a percent ("10",
// "-15.5"). Everything else stays at today's quotes.
export type Shock = {
  dollar?: { kind: ScenarioDollar; change: string };
  price?: { symbol: string | null; change: string };
};

// A percent a scenario takes: above -100, so nothing is worth less than
// nothing, and at most 1000.
export const SCENARIO_CHANGE = /^-?\d{1,4}(\.\d{1,2})?$/;
export const validChange = (change: string): boolean =>
  SCENARIO_CHANGE.test(change) &&
  Number(change) > -100 &&
  Number(change) <= 1000;

const factorOf = (change: string) =>
  plus(exactOf("1"), over(exactOf(change), exactOf("100")));

const scaled = (value: string, change: string) =>
  stored(times(exactOf(value), factorOf(change)));

// Today's quotes with the shock applied.
export function shockedSnapshot(
  snapshot: QuoteSnapshot,
  shock: Shock,
): QuoteSnapshot {
  const fx = { ...snapshot.fx };
  if (shock.dollar) {
    const { kind, change } = shock.dollar;
    for (const each of kind === "all" ? UNIT_FX_KINDS : [kind]) {
      const rate = fx[each];
      if (rate) fx[each] = { ...rate, sell: scaled(rate.sell, change) };
    }
  }
  const prices = { ...snapshot.prices };
  if (shock.price) {
    const { symbol, change } = shock.price;
    for (const [each, quote] of Object.entries(prices)) {
      if (quote && (symbol === null || each === symbol)) {
        prices[each] = { ...quote, price: scaled(quote.price, change) };
      }
    }
  }
  return { ...snapshot, fx, prices };
}

const DOLLAR_NAMES: Record<ScenarioDollar, string> = {
  mep: "el dólar MEP",
  ccl: "el dólar CCL",
  official: "el dólar oficial",
  all: "el dólar (MEP, CCL y oficial)",
};

// What a shock assumes, in the user's words: "el dólar MEP sube 10 %".
export function assumptionsOf(
  shock: Shock,
  instrumentName: string | null,
): string[] {
  const moved = (change: string) => {
    // "10 %", not "10,0 %": the percent as the user said it.
    const size = formatShare(change.replace(/^-/, "")).replace(",0 %", " %");
    return change.startsWith("-") ? `baja ${size}` : `sube ${size}`;
  };
  return [
    ...(shock.dollar
      ? [`${DOLLAR_NAMES[shock.dollar.kind]} ${moved(shock.dollar.change)}`]
      : []),
    ...(shock.price
      ? [
          `${
            shock.price.symbol === null
              ? "el precio de todos tus activos con cotización"
              : `el precio de ${instrumentName ?? shock.price.symbol}`
          } ${moved(shock.price.change)}`,
        ]
      : []),
  ];
}

// Net worth today and under the shock, side by side, the chart labelled as
// the hypothetical it is.
export const scenarioChart = (
  outcome: { today: { netWorth: string }; scenario: { netWorth: string } },
  unit: ChatUnit,
): ChartPart =>
  barsOf("bars", "Escenario hipotético: tu patrimonio neto", unit, [
    { label: "Hoy", value: outcome.today.netWorth },
    { label: "Hipotético", value: outcome.scenario.netWorth },
  ]);

// Net worth today and under the shock, in one unit: what is held less what
// is owed, each valued at today's quotes and at the shocked ones. Only a
// calculation: it changes the quotes named and nothing else.
export function scenarioOf({
  holdings,
  liabilities,
  snapshot,
  unit,
  referenceDollar,
  shock,
}: {
  holdings: readonly Holding[];
  liabilities: readonly Liability[];
  snapshot: QuoteSnapshot;
  unit: ChatUnit;
  referenceDollar: ReferenceDollar;
  shock: Shock;
}) {
  const options = { denominator: unit, referenceDollar };
  const worthAt = (quotes: QuoteSnapshot) => {
    const held = valueHoldings(holdings, quotes, options);
    const owed = valueLiabilities(liabilities, quotes, options);
    return {
      ...worthOfAssets(held.total, owed.total),
      complete: held.complete && owed.complete,
      missing: held.missing,
    };
  };
  const today = worthAt(snapshot);
  const shocked = worthAt(shockedSnapshot(snapshot, shock));
  const change = minus(exactOf(shocked.netWorth), exactOf(today.netWorth));
  const base = exactOf(today.netWorth);
  return {
    today: {
      assets: today.assets,
      debts: today.debts,
      netWorth: today.netWorth,
    },
    scenario: {
      assets: shocked.assets,
      debts: shocked.debts,
      netWorth: shocked.netWorth,
    },
    change: stored(change),
    // A fraction of today's net worth; none when it is not above zero.
    share: base.n > 0n ? stored(over(change, base)) : null,
    complete: today.complete && shocked.complete,
    missing: today.missing,
  };
}
