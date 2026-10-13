"use client";

import { notFound } from "next/navigation";

import { type Scope, ScopePage } from "@/components/holdings/scope-page";
import { parseAssetsParams, TABS } from "@/lib/holdings/assets-filter";
import { instrumentNames } from "@/lib/holdings/holding-name";
import type { HoldingRow } from "@/lib/holdings/read";
import { holdingsValuation } from "@/lib/holdings/valuation-view";
import { SCOPE_HREFS } from "@/lib/holdings/scope-hrefs";
import type { KeysetParams } from "@/lib/supabase/keyset";

import { usePrototype } from "./prototype-provider";
import { prototypeMovementsInput } from "./prototype-movements";
import {
  allRows,
  holdingsView,
  homeUnit,
  positionsOf,
} from "./prototype-store";

// An account's or portfolio's page over the prototype's store.
export function PrototypeScope({
  kind,
  id,
  params,
}: {
  kind: Scope["kind"];
  id: string;
  params: KeysetParams;
}) {
  const { state, latest, snapshot } = usePrototype();
  const account = state.accounts.find((each) => each.id === id);
  const portfolio = state.portfolios.find((each) => each.id === id);
  const scope: Scope | null =
    kind === "account"
      ? account
        ? { kind, id, institution: account.institution }
        : null
      : portfolio
        ? { kind, id, name: portfolio.name }
        : null;
  if (!scope) notFound();
  const inScope = (row: HoldingRow) =>
    kind === "account" ? row.account.id === id : row.portfolio.id === id;
  const rows = holdingsView(state).active.filter(inScope);
  const open = new Set(rows.map((row) => row.id));
  const reference = homeUnit(state);
  const { unit: chosen } = parseAssetsParams(params, {
    portfolioIds: [],
    tabs: TABS,
    salesYears: [],
  });
  const unit = chosen ?? reference;
  return (
    <ScopePage
      scope={scope}
      rows={rows}
      soldRows={allRows(state).filter(
        (row) => inScope(row) && !open.has(row.id),
      )}
      valuation={holdingsValuation({
        holdings: rows,
        truncated: false,
        snapshot,
        unit,
        referenceDollar: state.referenceDollar,
      })}
      positions={positionsOf(state, unit)}
      names={instrumentNames(state.instruments)}
      unit={unit}
      referenceUnit={reference}
      params={params}
      hrefs={SCOPE_HREFS}
      backHref="/assets"
      revision={rows.map((row) => state.revisions.get(row.id) ?? 0).join(".")}
      loadMovements={prototypeMovementsInput(latest).loadMovements}
    />
  );
}
