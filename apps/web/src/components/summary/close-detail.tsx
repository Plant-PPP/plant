"use client";

import { type Denominator, isTrade } from "@plant/core";
import type { ColumnDef } from "@tanstack/react-table";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import {
  AmountText,
  NUMBER_CELL,
  SummaryTile,
} from "@/components/holdings/sum-text";
import { DataTable, TruncatedText } from "@/components/ui/data-table";
import { formatAmount, formatQuantity } from "@/lib/format/amount";
import { formatDate } from "@/lib/format/date";
import { lineLabel } from "@/lib/holdings/messages";
import { formatQuotedPrice } from "@/lib/holdings/price-input";
import {
  type MonthClose,
  type MonthDetail,
  monthInText,
  type YearClose,
} from "@/lib/summary/closes";

import { ClosesTable } from "./closes-table";
import { CloseStatus, ResultText } from "./figures";

type Figures = YearClose["totals"];

function Header({
  title,
  status,
  backHref,
}: {
  title: string;
  status: ReactNode;
  backHref: string;
}) {
  return (
    <div className="grid gap-3">
      <Link
        href={backHref}
        className="text-muted-foreground hover:text-foreground inline-flex w-fit items-center gap-1 text-sm"
      >
        <ArrowLeft aria-hidden className="size-4" />
        Resumen
      </Link>
      <h1 className="flex flex-wrap items-center gap-2 text-xl font-semibold">
        {title}
        {status}
      </h1>
    </div>
  );
}

// The figures every close shows, month or year alike.
function CloseFigures({
  figures,
  unit,
  complete,
  year = false,
}: {
  figures: Figures;
  unit: Denominator;
  complete: boolean;
  // A year's return also leaves out a month whose own could not be measured.
  year?: boolean;
}) {
  return (
    <div className="grid gap-3">
      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryTile label="Patrimonio neto al inicio">
          <AmountText amount={figures.startValue} unit={unit} />
        </SummaryTile>
        <SummaryTile label="Patrimonio neto al final">
          <AmountText amount={figures.endValue} unit={unit} />
        </SummaryTile>
        <SummaryTile
          label="Resultado"
          note="Mercado más cobros menos gastos; el % no cuenta lo que pusiste"
        >
          <ResultText
            amount={figures.result}
            share={figures.share}
            unit={unit}
          />
        </SummaryTile>
        <SummaryTile
          label="Aportes netos"
          note={`Entró ${formatAmount(figures.paidIn, unit)} y salió ${formatAmount(figures.proceeds, unit)}`}
        >
          <AmountText amount={figures.contributed} unit={unit} />
        </SummaryTile>
      </dl>
      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryTile label="Resultado de mercado" note="Precios y dólar">
          <ResultText amount={figures.market} share={null} unit={unit} />
        </SummaryTile>
        <SummaryTile label="Dividendos y cupones" note="Antes de retenciones">
          <AmountText amount={figures.income} unit={unit} />
        </SummaryTile>
        <SummaryTile label="Resultado de ventas">
          <AmountText amount={figures.realized} unit={unit} />
        </SummaryTile>
        <SummaryTile
          label="Gastos"
          note="Comisiones, derechos, impuestos y retenciones"
        >
          <AmountText amount={figures.charges} unit={unit} />
        </SummaryTile>
      </dl>
      {!complete && (
        <p className="text-muted-foreground text-xs">
          Faltó algún dato: la cotización de un activo o una deuda al inicio o
          al final, un movimiento que no se puede pasar a esta moneda o el
          precio de un saldo inicial o un ajuste de salida ese día, que cuentan
          a su costo
          {year && ", o el rendimiento de algún mes, que no se pudo medir"}.
        </p>
      )}
    </div>
  );
}

type Line = MonthDetail["lines"][number] & { id: string };

// One month's close and what moved in it.
export function MonthCloseDetail({
  detail: { close, lines },
  unit,
  backHref,
}: {
  detail: MonthDetail;
  unit: Denominator;
  backHref: string;
}) {
  const columns: ColumnDef<Line>[] = [
    {
      id: "date",
      header: "Fecha",
      size: 104,
      cell: ({ row: { original } }) => formatDate(original.movement.date),
    },
    {
      id: "asset",
      header: "Activo",
      cell: ({ row: { original } }) => (
        <>
          <TruncatedText className="font-medium" text={original.holdingName} />
          <TruncatedText
            className="text-muted-foreground text-xs @2xl:hidden"
            text={lineLabel(original)}
          />
        </>
      ),
    },
    {
      id: "kind",
      header: "Tipo",
      size: 112,
      meta: { className: "hidden @2xl:table-cell text-muted-foreground" },
      cell: ({ row: { original } }) => lineLabel(original),
    },
    {
      id: "quantity",
      header: "Cantidad",
      size: 112,
      meta: { className: `hidden @xl:table-cell ${NUMBER_CELL}` },
      cell: ({ row: { original } }) =>
        isTrade(original.movement)
          ? formatQuantity(original.movement.quantity)
          : null,
    },
    {
      id: "price",
      header: "Precio",
      size: 136,
      meta: { className: `hidden @3xl:table-cell ${NUMBER_CELL}` },
      cell: ({ row: { original } }) =>
        isTrade(original.movement) &&
        original.movement.kind !== "transfer" &&
        original.movement.price !== null &&
        !original.atWorth
          ? formatQuotedPrice(
              original.movement.price,
              original.movement.currency,
              original.instrumentType,
            )
          : null,
    },
    {
      id: "amount",
      header: "Importe",
      size: 136,
      meta: { className: NUMBER_CELL },
      cell: ({ row: { original } }) => (
        <AmountText amount={original.amount} unit={unit} />
      ),
    },
  ];
  return (
    <div className="grid gap-6">
      <Header
        title={`Cierre de ${monthInText(close.period)}`}
        status={<CloseStatus close={close} />}
        backHref={backHref}
      />
      <CloseFigures
        figures={{ ...close.figures, realized: close.realized }}
        unit={unit}
        complete={close.complete}
      />
      <section className="grid gap-3">
        <h2 className="text-base font-semibold">Compras, ventas y cobros</h2>
        {lines.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No hubo movimientos este mes.
          </p>
        ) : (
          <>
            <DataTable
              caption={`Movimientos de ${monthInText(close.period)}`}
              columns={columns}
              data={lines.map((line) => ({ ...line, id: line.movement.id }))}
            />
            {lines.some((line) => line.atWorth) && (
              <p className="text-muted-foreground text-xs">
                Los saldos iniciales y los ajustes de salida figuran a lo que
                valían ese día, como los cuenta el cierre.
              </p>
            )}
          </>
        )}
      </section>
    </div>
  );
}

// One year's close: its sum and each of its months.
export function YearCloseDetail({
  year,
  unit,
  backHref,
  closeHref,
}: {
  year: YearClose;
  unit: Denominator;
  backHref: string;
  closeHref: (period: string) => string;
}) {
  const recalculated = year.months.some(
    (each: MonthClose) => each.recalculatedOn !== null,
  );
  return (
    <div className="grid gap-6">
      <Header
        title={`Cierre de ${year.year}`}
        status={
          <CloseStatus
            close={{
              open: year.open,
              recalculatedOn: recalculated
                ? year.months
                    .map((each) => each.recalculatedOn ?? "")
                    .sort()
                    .at(-1)!
                : null,
            }}
          />
        }
        backHref={backHref}
      />
      <CloseFigures
        figures={year.totals}
        unit={unit}
        complete={year.complete}
        year
      />
      <section className="grid gap-3">
        <h2 className="text-base font-semibold">Mes a mes</h2>
        <ClosesTable year={year} unit={unit} href={closeHref} />
      </section>
    </div>
  );
}
