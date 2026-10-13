"use client";

import { realEstateFigures } from "@plant/core";

import {
  AssetsSetup,
  type ScopeHrefs,
} from "@/components/holdings/assets-setup";
import { SALES_TABS } from "@/lib/holdings/assets-filter";
import { assetsSelection } from "@/lib/holdings/assets-selection";
import { instrumentNames } from "@/lib/holdings/holding-name";
import type { MovementsInput } from "@/lib/holdings/movements-input";
import { holdingsValuation } from "@/lib/holdings/valuation-view";
import { SALES_LIMIT } from "@/lib/portfolio-setup/limits";
import type { KeysetParams } from "@/lib/supabase/keyset";

import { sheetTerms } from "@/lib/real-estate/sheet";

import { usePrototype } from "./prototype-provider";
import { prototypeMovementsInput } from "./prototype-movements";
import {
  holdingsView,
  homeUnit,
  positionsOf,
  salesOf,
  yearsOf,
} from "./prototype-store";

export const PROTOTYPE_HREFS: ScopeHrefs = {
  instrument: (symbol) => `/assets/${encodeURIComponent(symbol)}`,
  account: (id) => `/accounts/${id}`,
  portfolio: (id) => `/portfolios/${id}`,
};

// Activos over the prototype's store, with movements and the sales tab.
export function PrototypeAssets({ params }: { params: KeysetParams }) {
  const { state, latest, snapshot, manual, fed, details, actions } =
    usePrototype();
  const names = instrumentNames(state.instruments);
  const view = holdingsView(state);
  const years = yearsOf(state);
  const {
    unit: chosenUnit,
    year,
    filter,
    shown,
  } = assetsSelection({
    params,
    rows: view.active,
    portfolioIds: state.portfolios.map(({ id }) => id),
    tabs: SALES_TABS,
    salesYears: years,
    names,
  });
  const reference = homeUnit(state);
  const unit = chosenUnit ?? reference;
  const valuation = holdingsValuation({
    holdings: shown,
    truncated: false,
    snapshot,
    unit,
    referenceDollar: state.referenceDollar,
  });
  const movements: MovementsInput = {
    positions: positionsOf(state, unit),
    revisions: state.revisions,
    sales: salesOf(state, {
      year,
      unit,
      filter,
      names,
      limit: SALES_LIMIT,
    }),
    years,
    ...prototypeMovementsInput(latest),
  };

  return (
    <AssetsSetup
      holdings={view}
      valuation={valuation}
      unit={unit}
      referenceUnit={reference}
      filter={filter}
      params={params}
      accounts={state.accounts}
      portfolios={state.portfolios}
      instruments={state.instruments}
      today={state.today}
      tabs={SALES_TABS}
      actions={actions.holdings}
      movements={movements}
      movementActions={actions.movements}
      prices={{ manual, fed, actions: actions.prices }}
      details={details}
      realEstate={{
        sheetOf: (id) => state.realEstate.get(id),
        liabilities: state.liabilities.map(({ id, label }) => ({ id, label })),
        figures: (row, sheet, view) =>
          row.holding.asset_class === "real_estate"
            ? realEstateFigures(
                sheetTerms(
                  row.holding,
                  sheet,
                  state.liabilities.find(({ id }) => id === sheet.liabilityId),
                ),
                view,
                snapshot,
                state.referenceDollar,
              )
            : { netMonthly: null, rentalYield: null, appreciation: null },
        save: actions.realEstate,
      }}
      hrefs={PROTOTYPE_HREFS}
    />
  );
}
