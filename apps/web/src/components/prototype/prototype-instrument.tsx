"use client";

import { priceSource, referenceUnit } from "@plant/core";
import { notFound } from "next/navigation";

import { InstrumentHistory } from "@/components/holdings/instrument-history";
import { parseAssetsParams, TABS } from "@/lib/holdings/assets-filter";
import { instrumentSummary } from "@/lib/holdings/instrument-history";
import { holdingsValuation } from "@/lib/holdings/valuation-view";
import type { KeysetParams } from "@/lib/supabase/keyset";

import { usePrototype } from "./prototype-provider";
import { instrumentHoldings, movementsPage } from "./prototype-store";

// An instrument's history over the prototype's store.
export function PrototypeInstrument({
  symbol,
  params,
}: {
  symbol: string;
  params: KeysetParams;
}) {
  const { state, latest, snapshot, manual } = usePrototype();
  const instrument = state.instruments.find((each) => each.symbol === symbol);
  if (!instrument) notFound();
  const reference = referenceUnit(state.referenceDollar);
  const { unit: chosen } = parseAssetsParams(params, {
    portfolioIds: [],
    tabs: TABS,
    salesYears: [],
  });
  const unit = chosen ?? reference;
  const { holdings, flows } = instrumentHoldings(state, symbol, unit, snapshot);
  if (holdings.length === 0) notFound();
  // One unit's price in the page's unit, as Activos shows it.
  const one = holdingsValuation({
    holdings: [
      {
        ...holdings[0]!.row,
        holding: { ...holdings[0]!.row.holding, amount: "1" },
      },
    ],
    truncated: false,
    snapshot,
    unit,
    referenceDollar: state.referenceDollar,
  });
  const quote = snapshot.prices[symbol];
  return (
    <InstrumentHistory
      instrument={instrument}
      price={{
        value: one.values[holdings[0]!.row.id]?.price ?? null,
        source: priceSource(symbol, {
          snapshot,
          manual: new Map([...manual].map(([key, each]) => [key, each.date])),
        }),
        date: quote?.date ?? null,
      }}
      unit={unit}
      referenceUnit={reference}
      params={params}
      backHref="/assets"
      holdings={holdings}
      summary={instrumentSummary(holdings, flows, state.today)}
      revision={holdings
        .map((each) => state.revisions.get(each.row.id) ?? 0)
        .join(".")}
      loadMovements={async (scope, inUnit, cursor) =>
        movementsPage(latest(), scope, inUnit, cursor)
      }
    />
  );
}
