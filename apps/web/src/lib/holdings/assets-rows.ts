import type { Holding, Position } from "@plant/core";
import { sumOrNull } from "@plant/shared";

import { costTotals, overExactSum, type CostTotals } from "./cost-totals";
import type { HoldingRow } from "./read";
import type { HoldingsValuation } from "./valuation-view";

// A Tenencias row: an instrument across the holdings of it shown, or any
// other holding on its own.
export type AssetsRow<R extends HoldingRow> =
  | { kind: "instrument"; id: string; symbol: string; rows: [R, ...R[]] }
  | { kind: "holding"; id: string; row: R };

// What the user sees as one asset: an instrument, across every holding of
// it, or any other holding on its own. Only `assetKey` makes one, so a
// holding's id never passes for an instrument's key.
export type AssetKey = string & { readonly __brand: "AssetKey" };

export const assetKey = (holding: Holding): AssetKey =>
  (holding.asset_class === "instrument"
    ? `instrument:${holding.instrument_symbol}`
    : holding.id) as AssetKey;

// Instrument holdings merged by symbol, in the order each symbol first
// appears; every other holding on its own.
export function byInstrument<R extends HoldingRow>(
  rows: readonly R[],
): AssetsRow<R>[] {
  const merged: AssetsRow<R>[] = [];
  const bySymbol = new Map<string, R[]>();
  for (const row of rows) {
    if (row.holding.asset_class !== "instrument") {
      merged.push({ kind: "holding", id: assetKey(row.holding), row });
      continue;
    }
    const symbol = row.holding.instrument_symbol;
    const group = bySymbol.get(symbol);
    if (group) {
      group.push(row);
      continue;
    }
    const started: [R, ...R[]] = [row];
    bySymbol.set(symbol, started);
    merged.push({
      kind: "instrument",
      id: assetKey(row.holding),
      symbol,
      rows: started,
    });
  }
  return merged;
}

// Every holding on its own.
export const byHolding = <R extends HoldingRow>(
  rows: readonly R[],
): AssetsRow<R>[] => rows.map((row) => ({ kind: "holding", id: row.id, row }));

export const holdingsOf = <R extends HoldingRow>(
  row: AssetsRow<R>,
): [R, ...R[]] => (row.kind === "instrument" ? row.rows : [row.row]);

// What a row's cells show, in the page's unit. An instrument's value and
// share are its exact sum's, unknown when any of its holdings has no quote.
export type RowFigures = {
  // Its holdings' amounts added up: an instrument's units, or the amount.
  quantity: string;
  accounts: HoldingRow["account"][];
  portfolios: HoldingRow["portfolio"][];
  value: string | null;
  share: string | null;
  // The date of the oldest quote or valuation its value used.
  asOf: string | null;
  // One unit's price, the same for every holding of an instrument.
  price: string | null;
  // Cost, gain and units of the holdings with movements; none without them.
  cost: CostTotals | null;
};

export function rowFigures<R extends HoldingRow>(
  row: AssetsRow<R>,
  {
    valuation,
    positions,
  }: {
    valuation: Pick<HoldingsValuation, "values" | "instruments">;
    positions?: ReadonlyMap<string, Position>;
  },
): RowFigures {
  const holdings = holdingsOf(row);
  const values = holdings.map((each) => valuation.values[each.id]);
  const sum =
    row.kind === "instrument" ? valuation.instruments[row.symbol] : null;
  const known = sum ? (sum.missing === 0 ? sum : null) : null;
  const dates = values.flatMap((each) => (each?.asOf ? [each.asOf] : []));
  const cost = positions
    ? costTotals(
        holdings.map((each, index) => ({
          position: positions.get(each.id),
          value: values[index]?.value,
        })),
      )
    : null;
  return {
    // A holding's amount is never null, so neither is their sum.
    quantity: sumOrNull(holdings.map((each) => each.holding.amount))!,
    accounts: distinct(holdings.map((each) => each.account)),
    portfolios: distinct(holdings.map((each) => each.portfolio)),
    value:
      row.kind === "instrument"
        ? (known?.value ?? null)
        : (values[0]?.value ?? null),
    share:
      row.kind === "instrument"
        ? (known?.share ?? null)
        : (values[0]?.share ?? null),
    asOf: dates.length === 0 ? null : dates.sort()[0]!,
    price: values.find((each) => each?.price != null)?.price ?? null,
    cost: cost && overExactSum(cost, sum),
  };
}

// Each item once, by id, in the order first seen.
export const distinct = <T extends { id: string }>(
  items: readonly T[],
): T[] => {
  const seen = new Set<string>();
  return items.filter((item) =>
    seen.has(item.id) ? false : (seen.add(item.id), true),
  );
};
