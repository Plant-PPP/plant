"use client";

import { notFound } from "next/navigation";
import { useState } from "react";

import { DebtHistory } from "@/components/debts/debt-history";
import { debtPageInputs } from "@/lib/debts/page-inputs";
import { parseAssetsParams, TABS } from "@/lib/holdings/assets-filter";
import type { KeysetParams } from "@/lib/supabase/keyset";

import { usePrototype } from "./prototype-provider";
import { holdingsView, homeUnit } from "./prototype-store";

// A debt's page over the prototype's store. One it deletes here sends the
// user back to Deudas, so the page only renders while the debt exists.
export function PrototypeDebt({
  id,
  params,
}: {
  id: string;
  params: KeysetParams;
}) {
  const { state, snapshot, actions } = usePrototype();
  const debt = state.liabilities.find((each) => each.id === id);
  const [existed] = useState(() => debt !== undefined);
  if (!existed) notFound();
  if (!debt) return null;
  const reference = homeUnit(state);
  const unit =
    parseAssetsParams(params, { portfolioIds: [], tabs: TABS, salesYears: [] })
      .unit ?? reference;
  return (
    <DebtHistory
      debt={debt}
      events={state.liabilityEvents.get(id) ?? []}
      collateral={state.liabilityCollateral.get(id) ?? []}
      installments={state.liabilityInstallments.get(id) ?? []}
      complete
      today={state.today}
      snapshot={snapshot}
      unit={unit}
      referenceUnit={reference}
      referenceDollar={state.referenceDollar}
      params={params}
      instruments={state.instruments}
      {...debtPageInputs(
        holdingsView(state).active,
        state.instruments,
        debt,
        snapshot,
        unit,
        state.referenceDollar,
      )}
      actions={{
        events: actions.debtEvents,
        debts: actions.debts,
        collateral: actions.debtCollateral,
        installments: actions.debtInstallments,
      }}
    />
  );
}
