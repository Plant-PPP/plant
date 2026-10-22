"use client";

import { valueLiabilities } from "@plant/core";

import { debtsToday } from "@/lib/summary/compute";

import { DebtsSetup } from "@/components/debts/debts-setup";
import { debtPlans } from "@/lib/debts/plans";
import { parseAssetsParams, TABS } from "@/lib/holdings/assets-filter";
import type { KeysetParams } from "@/lib/supabase/keyset";

import { usePrototype } from "./prototype-provider";
import { homeUnit } from "./prototype-store";

// Deudas over the prototype's store.
export function PrototypeDebts({ params }: { params: KeysetParams }) {
  const { state, snapshot, actions } = usePrototype();
  const reference = homeUnit(state);
  const unit =
    parseAssetsParams(params, { portfolioIds: [], tabs: TABS, salesYears: [] })
      .unit ?? reference;
  return (
    <DebtsSetup
      debts={{
        active: state.liabilities,
        activeTruncated: false,
        archived: [],
        archivedPage: null,
        archivedFirstHref: null,
        archivedNextHref: null,
      }}
      owed={debtsToday(state)}
      complete
      plans={debtPlans(state.liabilityInstallments, state.liabilityEvents)}
      valued={valueLiabilities(debtsToday(state), snapshot, {
        denominator: unit,
        referenceDollar: state.referenceDollar,
      })}
      unit={unit}
      referenceUnit={reference}
      params={params}
      instruments={state.instruments}
      actions={actions.debts}
    />
  );
}
