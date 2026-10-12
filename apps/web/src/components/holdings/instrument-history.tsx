"use client";

import { type Denominator, type PriceSource } from "@plant/core";
import type { ColumnDef } from "@tanstack/react-table";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";

import { useId } from "react";

import { DataTable, TruncatedText } from "@/components/ui/data-table";
import {
  formatAmount,
  formatQuantity,
  formatFraction,
} from "@/lib/format/amount";
import { formatDate } from "@/lib/format/date";
import { HOLDING_CLASS_LABELS } from "@/lib/holdings/classes";
import type {
  InstrumentHolding,
  InstrumentSummary,
} from "@/lib/holdings/instrument-history";
import type { MovementsInput } from "@/lib/holdings/movements-input";
import { formatQuotedPrice } from "@/lib/holdings/price-input";
import type { InstrumentRow } from "@/lib/holdings/read";
import type { KeysetParams } from "@/lib/supabase/keyset";

import { useAssetsUrl } from "./assets-url";
import { UnitSelect } from "./filter-select";
import { AccountCell, TickerChip } from "./holding-cells";
import { MovementsTable } from "./movements-table";
import {
  AmountText,
  GainLossText,
  MissingFigure,
  NO_QUOTE,
  NUMBER_CELL,
  SummaryTile,
} from "./sum-text";

type Row = InstrumentHolding & { id: string };

const money = (value: string | null | undefined, unit: Denominator) => (
  <AmountText amount={value} unit={unit} />
);

// A fraction as a percent to one decimal.

// Everything that happened to one instrument, in every account and
// portfolio: what it is worth and what it made, where it is held, and each
// movement, newest first.
export function InstrumentHistory({
  instrument,
  price,
  unit,
  referenceUnit,
  params,
  backHref,
  holdings,
  summary,
  revision,
  loadMovements,
}: {
  instrument: InstrumentRow;
  // One unit's price in the page's unit, and where it came from.
  price: { value: string | null; source: PriceSource; date: string | null };
  unit: Denominator;
  referenceUnit: Denominator;
  params: KeysetParams;
  backHref: string;
  holdings: InstrumentHolding[];
  summary: InstrumentSummary;
  // Changes when any of its movements does, so the list reads them again.
  revision: string;
  loadMovements: MovementsInput["loadMovements"];
}) {
  const url = useAssetsUrl(params);
  const unitId = useId();
  const returns = summary.returns;
  const where = (row: InstrumentHolding["row"]) =>
    `${row.account.institution} · ${row.portfolio.name}`;
  const byId = new Map(holdings.map((each) => [each.row.id, each.row]));

  const columns: ColumnDef<Row>[] = [
    {
      id: "account",
      header: "Cuenta",
      cell: ({ row: { original } }) => (
        <AccountCell institution={original.row.account.institution} />
      ),
    },
    {
      id: "portfolio",
      header: "Cartera",
      meta: { className: "hidden @xl:table-cell text-muted-foreground" },
      cell: ({ row: { original } }) => (
        <TruncatedText text={original.row.portfolio.name} />
      ),
    },
    {
      id: "quantity",
      header: "Cantidad",
      size: 128,
      meta: { className: NUMBER_CELL },
      cell: ({ row: { original } }) =>
        original.closed
          ? "Vendida"
          : formatQuantity(original.position.quantity),
    },
    {
      id: "cost",
      header: "Costo",
      size: 144,
      meta: { className: `hidden @2xl:table-cell ${NUMBER_CELL}` },
      cell: ({ row: { original } }) =>
        original.closed ? null : money(original.position.money?.cost, unit),
    },
    {
      id: "value",
      header: "Valor",
      size: 144,
      meta: { className: NUMBER_CELL },
      cell: ({ row: { original } }) =>
        original.closed ? null : money(original.value, unit),
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
              {instrument.name}
              <TickerChip ticker={instrument.symbol} />
            </h1>
            <p className="text-muted-foreground text-sm">
              {HOLDING_CLASS_LABELS[instrument.type]} ·{" "}
              {price.value === null
                ? NO_QUOTE
                : `${formatQuotedPrice(price.value, unit, instrument.type)} ${
                    price.source === "manual" && price.date
                      ? `(manual, ${formatDate(price.date)})`
                      : price.date
                        ? `al ${formatDate(price.date)}`
                        : ""
                  }`}
            </p>
          </div>
          <UnitSelect
            id={unitId}
            unit={unit}
            referenceUnit={referenceUnit}
            pending={false}
            onChange={(param) => url.set("unit", param)}
          />
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryTile
          label="Valor actual"
          note={`${formatQuantity(summary.quantity)} ${instrument.symbol}`}
        >
          {money(summary.value, unit)}
        </SummaryTile>
        <SummaryTile
          label="Resultado total"
          note={
            returns?.share == null
              ? "Ventas, cobros y lo que tenés hoy"
              : `${formatFraction(returns.share)} sobre lo invertido`
          }
        >
          {returns ? (
            <GainLossText
              gain={{ amount: returns.result, percent: null }}
              unit={unit}
            />
          ) : (
            <MissingFigure text="Sin resultado" />
          )}
        </SummaryTile>
        <SummaryTile
          label="Rendimiento anual (TIR)"
          note={
            returns && returns.annual === null
              ? "Con menos de un año no se anualiza"
              : "Según cuándo pusiste y sacaste plata"
          }
        >
          {returns?.annual != null ? (
            formatFraction(returns.annual)
          ) : (
            <MissingFigure text="Sin rendimiento anual" />
          )}
        </SummaryTile>
        <SummaryTile
          label="G/P no realizada"
          note="De lo que tenés hoy, sobre su costo"
        >
          <GainLossText gain={summary.unrealized} unit={unit} />
        </SummaryTile>
      </dl>
      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryTile label="Costo de lo que tenés">
          {money(summary.cost, unit)}
        </SummaryTile>
        <SummaryTile label="Resultado de ventas">
          {money(summary.realized, unit)}
        </SummaryTile>
        <SummaryTile label="Dividendos y cupones">
          {money(summary.income, unit)}
        </SummaryTile>
        <SummaryTile label="Gastos">{money(summary.charges, unit)}</SummaryTile>
      </dl>
      {returns && (
        <p className="text-muted-foreground text-xs">
          {`Pusiste ${formatAmount(returns.paidIn, unit)} y sacaste ${formatAmount(
            returns.paidOut,
            unit,
          )} entre ventas y cobros, cada monto a la cotización de su fecha.`}
        </p>
      )}

      <section className="grid gap-3" aria-labelledby={`${unitId}-where`}>
        <h2 id={`${unitId}-where`} className="text-base font-semibold">
          Dónde lo tenés
        </h2>
        <DataTable
          caption={`Tenencias de ${instrument.name}`}
          columns={columns}
          data={holdings.map((each) => ({ ...each, id: each.row.id }))}
        />
      </section>

      <section className="grid gap-3" aria-labelledby={`${unitId}-history`}>
        <h2 id={`${unitId}-history`} className="text-base font-semibold">
          Historial
        </h2>
        <MovementsTable
          key={`${revision}:${unit}`}
          scope={{ symbol: instrument.symbol }}
          unit={unit}
          instrumentTypes={new Map([[instrument.symbol, instrument.type]])}
          load={loadMovements}
          holdingName={(id) => {
            const row = byId.get(id);
            return row ? where(row) : "";
          }}
        />
      </section>
    </div>
  );
}
