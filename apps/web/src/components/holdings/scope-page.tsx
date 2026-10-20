"use client";

import { routeItemForPath } from "@/lib/navigation";
import { PageCrumbs } from "@/components/layout/page-crumbs";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Segmented, type SegmentedOption } from "@/components/ui/segmented";
import { type Denominator, type Position } from "@plant/core";
import type { ColumnDef } from "@tanstack/react-table";
import { Wallet } from "lucide-react";
import { type ReactNode, useId } from "react";

import { ClosesTable } from "@/components/summary/closes-table";
import { DataTable } from "@/components/ui/data-table";
import { formatAmount, formatQuantity } from "@/lib/format/amount";
import { HOLDING_CLASS_LABELS, classOf } from "@/lib/holdings/classes";
import { gainLoss } from "@/lib/holdings/cost-totals";
import { holdingName } from "@/lib/holdings/holding-name";
import type {
  MovementScope,
  MovementsInput,
} from "@/lib/holdings/movements-input";
import type { HoldingRow } from "@/lib/holdings/read";
import { type ScopeHrefs, scopeLink } from "@/lib/holdings/scope-hrefs";
import type { HoldingsValuation } from "@/lib/holdings/valuation-view";
import type { YearClose } from "@/lib/summary/closes";
import type { KeysetParams } from "@/lib/supabase/keyset";

import { AssetsSummary } from "./assets-summary";
import { useAssetsUrl } from "./assets-url";
import { UnitSelect } from "./filter-select";
import { NameLink } from "./holding-cells";
import { MovementsTable } from "./movements-table";
import {
  GainLossText,
  MissingFigure,
  NO_QUOTE,
  NUMBER_CELL,
  VALUE_CELL,
} from "./sum-text";

type ScopeTab = "holdings" | "movements" | "cash" | "closes";
const SCOPE_TABS: Record<ScopeTab, string> = {
  holdings: "Tenencias",
  movements: "Movimientos",
  cash: "Efectivo",
  closes: "Cierres",
};

// Whether two params differ only in their tab or closes' year, which the
// page shows from what it already has.
const onlyViewChanged = (next: KeysetParams, current: KeysetParams) =>
  [...new Set([...Object.keys(next), ...Object.keys(current)])].every(
    (key) => key === "tab" || key === "year" || next[key] === current[key],
  );

// What a scope page is about: an account, by its institution, or a
// portfolio.
export type Scope =
  | { kind: "account"; id: string; institution: string }
  | { kind: "portfolio"; id: string; name: string };

// One account's or portfolio's summary, valued and split as Activos does,
// over tabs for its holdings, its movements, newest first, and an account's
// cash, the tab kept in the URL.
export function ScopePage({
  scope,
  rows,
  soldRows,
  valuation,
  positions,
  names,
  unit,
  referenceUnit,
  params,
  hrefs,
  backHref,
  revision,
  loadMovements,
  firstMovements,
  connection,
  cash,
  closes,
}: {
  scope: Scope;
  rows: HoldingRow[];
  // Its holdings sold to zero, which only its movements show.
  soldRows: HoldingRow[];
  valuation: HoldingsValuation;
  positions: ReadonlyMap<string, Position>;
  names: ReadonlyMap<string, string>;
  unit: Denominator;
  referenceUnit: Denominator;
  params: KeysetParams;
  hrefs: ScopeHrefs;
  backHref: string;
  // Changes when any of its movements does, so the list reads them again.
  revision: string;
  loadMovements: MovementsInput["loadMovements"];
  firstMovements?: MovementsInput["firstMovements"];
  // An exchange account's connection by API, under its header.
  connection?: ReactNode;
  // An account's cash with its opening balances and history, its own tab.
  cash?: ReactNode;
  // Its closes by year, newest first, in the unit closes take.
  closes?: { years: YearClose[]; unit: Denominator };
}) {
  const url = useAssetsUrl(params, (next) => onlyViewChanged(next, params));
  const id = useId();
  const options: SegmentedOption<ScopeTab>[] = [
    { value: "holdings", label: SCOPE_TABS.holdings, count: rows.length },
    { value: "movements", label: SCOPE_TABS.movements },
    ...(cash ? [{ value: "cash" as const, label: SCOPE_TABS.cash }] : []),
    ...(closes ? [{ value: "closes" as const, label: SCOPE_TABS.closes }] : []),
  ];
  const year =
    closes?.years.find((each) => each.year === url.params.year) ??
    closes?.years[0];
  const tab =
    options.find((each) => each.value === url.params.tab)?.value ?? "holdings";
  const title = scope.kind === "account" ? scope.institution : scope.name;
  const movementScope: MovementScope =
    scope.kind === "account"
      ? { accountId: scope.id }
      : { portfolioId: scope.id };
  const byId = new Map([...rows, ...soldRows].map((row) => [row.id, row]));
  // Where a movement's holding is: the other half of the scope.
  const where = (row: HoldingRow) =>
    scope.kind === "account" ? row.portfolio.name : row.account.institution;

  const columns: ColumnDef<HoldingRow>[] = [
    {
      id: "name",
      header: "Activo",
      cell: ({ row: { original: row } }) => (
        <>
          <NameLink
            className="font-medium"
            text={holdingName(row.holding, names)}
            href={
              row.holding.asset_class === "instrument"
                ? (scopeLink(
                    hrefs,
                    "instrument",
                  )?.(row.holding.instrument_symbol) ?? null)
                : null
            }
          />
          <span className="text-muted-foreground block truncate text-xs">
            {`${HOLDING_CLASS_LABELS[classOf(row)]} · ${where(row)}`}
          </span>
        </>
      ),
    },
    {
      id: "held",
      header: "Cantidad",
      size: 144,
      meta: { className: `hidden @2xl:table-cell ${NUMBER_CELL}` },
      cell: ({ row: { original: row } }) =>
        row.holding.asset_class === "instrument"
          ? formatQuantity(row.holding.amount)
          : formatAmount(row.holding.amount, row.holding.currency),
    },
    {
      id: "gain",
      header: "G/P",
      size: 136,
      meta: { className: `hidden @xl:table-cell ${NUMBER_CELL}` },
      cell: ({ row: { original: row } }) => {
        const position = positions.get(row.id);
        if (!position) return null;
        return (
          <GainLossText
            gain={gainLoss(position, valuation.values[row.id]?.value ?? null)}
            unit={unit}
          />
        );
      },
    },
    {
      id: "value",
      header: "Valor",
      meta: { className: VALUE_CELL },
      cell: ({ row: { original: row } }) => {
        const value = valuation.values[row.id]?.value;
        return value == null ? (
          <MissingFigure text={NO_QUOTE} />
        ) : (
          formatAmount(value, unit)
        );
      },
    },
  ];

  const empty = rows.length === 0 && soldRows.length === 0;
  return (
    <div className="grid gap-4">
      <PageCrumbs
        crumbs={[
          {
            label: routeItemForPath(backHref)?.title ?? "Cuentas",
            href: backHref,
          },
          { label: title },
        ]}
      />
      <PageHeader
        title={title}
        filters={
          !empty && (
            <UnitSelect
              id={`${id}-unit`}
              unit={unit}
              referenceUnit={referenceUnit}
              pending={false}
              onChange={(param) => url.set("unit", param)}
            />
          )
        }
      />
      {connection}
      {empty ? (
        <>
          <EmptyState
            icon={Wallet}
            title={`${title} todavía no tiene tenencias`}
          >
            {scope.kind === "account"
              ? "Subí un resumen de esta cuenta en Cargar, o conectala si tu broker lo permite."
              : "Elegí esta cartera al cargar o editar una tenencia en Activos."}
          </EmptyState>
          {cash}
        </>
      ) : (
        <>
          <AssetsSummary valuation={valuation} unit={unit} pending={false} />
          <Segmented
            label="Vista"
            options={options}
            value={tab}
            onChange={(next) =>
              url.set("tab", next === "holdings" ? null : next)
            }
            controls={`${id}-panel`}
          />
          <div id={`${id}-panel`} role="tabpanel" className="grid gap-4">
            {tab === "holdings" &&
              (rows.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Hoy no tiene tenencias: las que vendiste están en Movimientos.
                </p>
              ) : (
                <DataTable
                  caption={`Tenencias de ${title}`}
                  columns={columns}
                  data={rows}
                />
              ))}
            {tab === "movements" && (
              <MovementsTable
                key={`${revision}:${unit}`}
                scope={movementScope}
                unit={unit}
                instrumentTypes={
                  new Map(
                    [...rows, ...soldRows].flatMap((row) =>
                      row.holding.asset_class === "instrument" &&
                      row.instrumentType
                        ? [[row.holding.instrument_symbol, row.instrumentType]]
                        : [],
                    ),
                  )
                }
                load={loadMovements}
                first={firstMovements}
                holdingName={(holdingId) => {
                  const row = byId.get(holdingId);
                  return row ? holdingName(row.holding, names) : "";
                }}
              />
            )}
            {tab === "cash" && cash}
            {tab === "closes" &&
              closes &&
              (year ? (
                <>
                  {closes.years.length > 1 && (
                    <Segmented
                      label="Años"
                      options={closes.years.map((each) => ({
                        value: each.year,
                        label: each.year,
                      }))}
                      value={year.year}
                      onChange={(next) =>
                        url.set(
                          "year",
                          next === closes.years[0]?.year ? null : next,
                        )
                      }
                    />
                  )}
                  <ClosesTable
                    year={year}
                    unit={closes.unit}
                    valueHeader="Valor"
                  />
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Cada mes se cierra solo cuando termina: el primero aparece
                  acá.
                </p>
              ))}
          </div>
        </>
      )}
    </div>
  );
}
