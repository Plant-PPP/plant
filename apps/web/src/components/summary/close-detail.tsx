"use client";

import { type Denominator, isTrade } from "@plant/core";
import type { ColumnDef } from "@tanstack/react-table";
import { PageCrumbs } from "@/components/layout/page-crumbs";
import type { ReactNode } from "react";

import { AmountText, NUMBER_CELL } from "@/components/holdings/sum-text";
import { DataTable, TruncatedText } from "@/components/ui/data-table";
import { formatAmount, formatQuantity } from "@/lib/format/amount";
import { formatDate } from "@/lib/format/date";
import { lineLabel } from "@/lib/holdings/messages";
import { formatQuotedPrice, shownPrice } from "@/lib/holdings/price-input";
import {
  closeHref,
  type MonthClose,
  type MonthDetail,
  monthInText,
  type YearClose,
} from "@/lib/summary/closes";

import { type Benchmarks, beyond } from "@/lib/summary/benchmarks";

import { ClosesTable } from "./closes-table";
import { CloseStatus, ResultText, ShareText } from "./figures";
import { StatTile } from "@/components/ui/stat-tile";

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
    <>
      <PageCrumbs
        crumbs={[{ label: "Resumen", href: backHref }, { label: title }]}
      />
      <div className="flex min-h-7 items-center gap-2">
        <h1 className="sr-only">{title}</h1>
        {status}
      </div>
    </>
  );
}

// The figures every close shows, month or year alike.
function CloseFigures({
  figures,
  unit,
  complete,
  benchmarks,
  year = false,
}: {
  figures: Figures;
  unit: Denominator;
  complete: boolean;
  benchmarks?: Benchmarks;
  // A year's return also leaves out a month whose own could not be measured.
  year?: boolean;
}) {
  return (
    <div className="grid gap-3">
      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Patrimonio neto al inicio">
          <AmountText amount={figures.startValue} unit={unit} />
        </StatTile>
        <StatTile label="Patrimonio neto al final">
          <AmountText amount={figures.endValue} unit={unit} />
        </StatTile>
        <StatTile
          label="Resultado"
          note="Mercado más rentas menos gastos; el % no cuenta lo que pusiste"
        >
          <ResultText
            amount={figures.result}
            share={figures.share}
            unit={unit}
          />
        </StatTile>
        <StatTile
          label="Aportes netos"
          note={`Entró ${formatAmount(figures.paidIn, unit)} y salió ${formatAmount(figures.proceeds, unit)}`}
        >
          <AmountText amount={figures.contributed} unit={unit} />
        </StatTile>
      </dl>
      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Resultado de mercado" note="Precios y dólar">
          <ResultText amount={figures.market} share={null} unit={unit} />
        </StatTile>
        <StatTile
          label="Dividendos, cupones y rendimientos"
          note="Antes de retenciones"
        >
          <AmountText amount={figures.income} unit={unit} />
        </StatTile>
        <StatTile label="Resultado realizado">
          <AmountText amount={figures.realized} unit={unit} />
        </StatTile>
        <StatTile
          label="Gastos"
          note="Comisiones, derechos, impuestos y retenciones"
        >
          <AmountText amount={figures.charges} unit={unit} />
        </StatTile>
      </dl>
      {/* A return in pesos set against prices and the dollar; in dollars it
          already is one. */}
      {unit === "ars" && benchmarks && (
        <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile label="Inflación" note="Según la UVA, que sigue al IPC">
            <ShareText share={benchmarks.inflation} />
          </StatTile>
          <StatTile
            label="Rendimiento real"
            note="Lo que ganaste por encima de la inflación"
          >
            <ShareText
              share={beyond(figures.share, benchmarks.inflation)}
              colored
            />
          </StatTile>
          <StatTile label="Dólar MEP">
            <ShareText share={benchmarks.dollar} />
          </StatTile>
          <StatTile
            label="Contra el dólar"
            note="Lo que ganaste por encima del dólar MEP"
          >
            <ShareText
              share={beyond(figures.share, benchmarks.dollar)}
              colored
            />
          </StatTile>
        </dl>
      )}
      {unit === "ars" && !benchmarks && (
        <p className="text-muted-foreground text-xs">
          El mes empezó sin tenencias: su rendimiento cubre solo una parte, así
          que no se compara con la inflación ni con el dólar.
        </p>
      )}
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
        shownPrice(original.movement) !== null && !original.atWorth
          ? formatQuotedPrice(
              shownPrice(original.movement)!,
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
        benchmarks={close.benchmarks}
      />
      <section className="grid gap-3">
        <h2 className="text-base font-semibold">Movimientos del mes</h2>
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
  closesQuery,
}: {
  year: YearClose;
  unit: Denominator;
  backHref: string;
  // The query each month's close keeps, from closesQuery.
  closesQuery: string;
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
        benchmarks={year.benchmarks}
        year
      />
      <section className="grid gap-3">
        <h2 className="text-base font-semibold">Mes a mes</h2>
        <ClosesTable
          year={year}
          unit={unit}
          href={(period) => closeHref(period, closesQuery)}
        />
      </section>
    </div>
  );
}
