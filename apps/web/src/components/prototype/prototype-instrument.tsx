"use client";

import { priceSource, referenceUnit } from "@plant/core";
import { notFound } from "next/navigation";
import { useState } from "react";

import { InstrumentHistory } from "@/components/holdings/instrument-history";
import { parseAssetsParams, TABS } from "@/lib/holdings/assets-filter";
import { instrumentSummary } from "@/lib/holdings/instrument-history";
import { holdingsValuation } from "@/lib/holdings/valuation-view";
import type { KeysetParams } from "@/lib/supabase/keyset";

import { prototypeMovementsInput } from "./prototype-movements";
import { usePrototype } from "./prototype-provider";
import { instrumentHoldings, positionsOf } from "./prototype-store";

// An instrument's history over the prototype's store. A symbol the user holds
// nothing of has no page; one whose last holding they delete here keeps it,
// saying so.
export function PrototypeInstrument({
  symbol,
  params,
}: {
  symbol: string;
  params: KeysetParams;
}) {
  const { state, latest, snapshot, manual, details, actions } = usePrototype();
  const instrument = state.instruments.find((each) => each.symbol === symbol);
  const reference = referenceUnit(state.referenceDollar);
  const { unit: chosen } = parseAssetsParams(params, {
    portfolioIds: [],
    tabs: TABS,
    salesYears: [],
  });
  const unit = chosen ?? reference;
  const { holdings, flows, value } = instrumentHoldings(
    state,
    symbol,
    unit,
    snapshot,
  );
  const [hadHoldings] = useState(() => holdings.length > 0);
  if (!instrument || (!hadHoldings && holdings.length === 0)) notFound();
  const first = holdings[0];
  // One unit's price in the page's unit, as Activos shows it.
  const one =
    first &&
    holdingsValuation({
      holdings: [
        { ...first.row, holding: { ...first.row.holding, amount: "1" } },
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
        value: (first && one?.values[first.row.id]?.price) ?? null,
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
      summary={instrumentSummary(holdings, flows, state.today, value)}
      movements={{
        positions: positionsOf(state, unit),
        revisions: state.revisions,
        ...prototypeMovementsInput(latest),
      }}
      movementActions={actions.movements}
      actions={actions.holdings}
      details={details}
      accounts={state.accounts}
      portfolios={state.portfolios}
      instruments={state.instruments}
      today={state.today}
    />
  );
}
