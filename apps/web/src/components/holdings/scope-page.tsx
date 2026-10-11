"use client";

import { DENOMINATORS, type Denominator, type Position } from "@plant/core";
import type { ColumnDef } from "@tanstack/react-table";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useId } from "react";

import { InstitutionIcon } from "@/components/portfolio-setup/institution-field";
import { DataTable } from "@/components/ui/data-table";
import { formatAmount, formatQuantity } from "@/lib/format/amount";
import { unitParam } from "@/lib/holdings/assets-filter";
import { HOLDING_CLASS_LABELS, classOf } from "@/lib/holdings/classes";
import { gainLoss } from "@/lib/holdings/cost-totals";
import { holdingName } from "@/lib/holdings/holding-name";
import { UNIT_LABELS } from "@/lib/holdings/messages";
import type {
  MovementScope,
  MovementsInput,
} from "@/lib/holdings/movements-input";
import type { HoldingRow } from "@/lib/holdings/read";
import type { HoldingsValuation } from "@/lib/holdings/valuation-view";
import type { KeysetParams } from "@/lib/supabase/keyset";

import type { ScopeHrefs } from "./assets-setup";
import { AssetsSummary } from "./assets-summary";
import { useAssetsUrl } from "./assets-url";
import { FilterSelect } from "./filter-select";
import { NameLink } from "./holding-cells";
import { MovementsTable } from "./movements-table";
import {
  GainLossText,
  MissingFigure,
  NO_QUOTE,
  NUMBER_CELL,
  VALUE_CELL,
} from "./sum-text";

// What a scope page is about: an account, by its institution, or a
// portfolio.
export type Scope =
  | { kind: "account"; id: string; institution: string }
  | { kind: "portfolio"; id: string; name: string };

// One account's or portfolio's holdings, valued and split as Activos does,
// and its movements, newest first.
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
}) {
  const url = useAssetsUrl(params);
  const id = useId();
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
                ? hrefs.instrument(row.holding.instrument_symbol)
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

  return (
    <div className="grid gap-6">
      <div className="grid gap-3">
        <Link
          href={backHref}
          className="text-muted-foreground hover:text-foreground inline-flex w-fit items-center gap-1 text-sm"
        >
          <ArrowLeft aria-hidden className="size-4" />
          Activos
        </Link>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="grid gap-1">
            <h1 className="flex items-center gap-2 text-xl font-semibold">
              {scope.kind === "account" && (
                <InstitutionIcon name={scope.institution} />
              )}
              {title}
            </h1>
            <p className="text-muted-foreground text-sm">
              {scope.kind === "account" ? "Cuenta" : "Cartera"} ·{" "}
              {rows.length === 1 ? "1 tenencia" : `${rows.length} tenencias`}
            </p>
          </div>
          <FilterSelect
            id={`${id}-unit`}
            label="Valuar en"
            value={unit}
            pending={false}
            options={(Object.keys(DENOMINATORS) as Denominator[]).map(
              (each) => [each, UNIT_LABELS[each]] as const,
            )}
            onChange={(value) =>
              url.set("unit", unitParam(value, referenceUnit))
            }
          />
        </div>
      </div>

      <AssetsSummary valuation={valuation} unit={unit} pending={false} />

      <section className="grid gap-3" aria-labelledby={`${id}-holdings`}>
        <h2 id={`${id}-holdings`} className="text-base font-semibold">
          Tenencias
        </h2>
        <DataTable
          caption={`Tenencias de ${title}`}
          columns={columns}
          data={rows}
        />
      </section>

      <section className="grid gap-3" aria-labelledby={`${id}-movements`}>
        <h2 id={`${id}-movements`} className="text-base font-semibold">
          Movimientos
        </h2>
        <MovementsTable
          key={`${revision}:${unit}`}
          scope={movementScope}
          unit={unit}
          instrumentTypes={
            new Map(
              [...rows, ...soldRows].flatMap((row) =>
                row.holding.asset_class === "instrument" && row.instrumentType
                  ? [[row.holding.instrument_symbol, row.instrumentType]]
                  : [],
              ),
            )
          }
          load={loadMovements}
          holdingName={(holdingId) => {
            const row = byId.get(holdingId);
            return row ? holdingName(row.holding, names) : "";
          }}
        />
      </section>
    </div>
  );
}
