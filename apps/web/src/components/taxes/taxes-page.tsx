"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { Download, Info } from "lucide-react";
import Link from "next/link";
import { useId } from "react";

import {
  AmountText,
  NUMBER_CELL,
  SummaryTile,
} from "@/components/holdings/sum-text";
import { ResultText } from "@/components/summary/figures";
import { PrintButton } from "@/components/summary/print-button";
import { Button } from "@/components/ui/button";
import { DataTable, TruncatedText } from "@/components/ui/data-table";
import { toCsv } from "@/lib/export/csv";
import { csvBlob, saveFile } from "@/lib/export/download";
import { formatAmount } from "@/lib/format/amount";
import { formatDate } from "@/lib/format/date";
import { HOLDING_CLASS_LABELS } from "@/lib/holdings/classes";
import { GAINS_LABELS, taxTables } from "@/lib/taxes/export";
import type { GainsGroup, TaxReport, WealthLine } from "@/lib/taxes/report";
import { cn } from "@/lib/utils";

// The page's address for a year: none for the year it opens on.
const yearHref = (year: string, defaultYear: string) =>
  year === defaultYear ? "/taxes" : `/taxes?year=${year}`;

const wealthColumns: ColumnDef<WealthLine & { id: string }>[] = [
  {
    id: "asset",
    header: "Activo",
    cell: ({ row: { original } }) => (
      <>
        <TruncatedText className="font-medium" text={original.name} />
        <span className="text-muted-foreground block text-xs">
          {HOLDING_CLASS_LABELS[original.holdingClass]}
          {original.exempt && " · Exento"}
        </span>
      </>
    ),
  },
  {
    id: "amount",
    header: "En su moneda",
    size: 160,
    meta: { className: `hidden @xl:table-cell ${NUMBER_CELL}` },
    cell: ({ row: { original } }) =>
      original.amount === null || original.currency === null ? (
        <AmountText amount={null} unit="ars" />
      ) : (
        formatAmount(original.amount, original.currency)
      ),
  },
  {
    id: "ars",
    header: "En pesos",
    size: 168,
    meta: { className: `font-medium ${NUMBER_CELL}` },
    cell: ({ row: { original } }) => (
      <AmountText amount={original.ars} unit="ars" />
    ),
  },
];

const gainsColumns: ColumnDef<GainsGroup & { id: string }>[] = [
  {
    id: "kind",
    header: "Concepto",
    cell: ({ row: { original } }) => GAINS_LABELS[original.kind],
  },
  {
    id: "count",
    header: "Operaciones",
    size: 120,
    meta: { className: `hidden @xl:table-cell ${NUMBER_CELL}` },
    cell: ({ row: { original } }) => original.count,
  },
  {
    id: "amount",
    header: "En pesos",
    size: 168,
    meta: { className: `font-medium ${NUMBER_CELL}` },
    cell: ({ row: { original } }) =>
      original.amount === null ? (
        <AmountText amount={null} unit="ars" />
      ) : (
        <ResultText amount={original.amount} share={null} unit="ars" />
      ),
  },
];

// Impuestos: a year's estimate for Bienes Personales and Ganancias, in pesos,
// with the rules it follows.
export function TaxesPage({
  report,
  years,
  defaultYear,
  placementKinds,
  assetExclusion,
}: {
  report: TaxReport;
  years: readonly string[];
  defaultYear: string;
  // Whether the data tells a plazo fijo from other placements at a rate;
  // without it, every one counts as a plazo fijo.
  placementKinds: boolean;
  // Whether the user can leave a single asset out, besides a whole account.
  assetExclusion: boolean;
}) {
  const id = useId();
  const { wealth, gains, officialBuy, euroBuy } = report;
  const holdsEuros = wealth.lines.some((line) => line.currency === "EUR");

  function download(index: number) {
    const table = taxTables(report)[index]!;
    saveFile(`${table.name}.csv`, csvBlob(toCsv(table.header, table.rows)));
  }

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Impuestos</h1>
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          <nav aria-label="Años" className="flex gap-1">
            {years.map((year) => (
              <Link
                key={year}
                href={yearHref(year, defaultYear)}
                aria-current={year === report.year ? "page" : undefined}
                className={cn(
                  "rounded-md px-2.5 py-1 text-sm tabular-nums",
                  year === report.year
                    ? "bg-muted font-medium"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {year}
              </Link>
            ))}
          </nav>
          <PrintButton />
        </div>
      </div>

      <p
        role="note"
        className="flex gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm"
      >
        <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
        <span>
          Esto es una estimación, no asesoramiento impositivo. Usa reglas
          simplificadas: revisalo con tu contador antes de presentar tus
          declaraciones juradas.
          {report.provisional &&
            ` ${report.year} está en curso: tus activos están valuados a hoy.`}
        </span>
      </p>

      <section className="grid gap-3" aria-labelledby={`${id}-wealth`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id={`${id}-wealth`} className="text-base font-semibold">
            Bienes Personales
          </h2>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="print:hidden"
            onClick={() => download(0)}
          >
            <Download />
            Bajar CSV
          </Button>
        </div>
        <dl className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <SummaryTile
            label={`Gravados al ${formatDate(report.date)}`}
            note="Lo que pagaría el impuesto, antes del mínimo no imponible"
          >
            <AmountText amount={wealth.taxable} unit="ars" />
          </SummaryTile>
          <SummaryTile
            label="Exentos"
            note="Plazos fijos, bonos y obligaciones negociables"
          >
            <AmountText amount={wealth.exempt} unit="ars" />
          </SummaryTile>
          <SummaryTile
            label="Dólar BNA comprador"
            note={
              officialBuy
                ? `Del ${formatDate(officialBuy.date)}`
                : "Sin cotización para ese día"
            }
          >
            <AmountText amount={officialBuy?.buy ?? null} unit="ars" />
          </SummaryTile>
          {holdsEuros && (
            <SummaryTile
              label="Euro BNA comprador"
              note={
                euroBuy
                  ? `Del ${formatDate(euroBuy.date)}`
                  : "Sin cotización para ese día"
              }
            >
              <AmountText amount={euroBuy?.buy ?? null} unit="ars" />
            </SummaryTile>
          )}
        </dl>
        {wealth.lines.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No tenías activos al {formatDate(report.date)}.
          </p>
        ) : (
          <DataTable
            caption={`Activos al ${formatDate(report.date)}`}
            columns={wealthColumns}
            data={wealth.lines.map((line) => ({ ...line, id: line.key }))}
          />
        )}
        <ul className="text-muted-foreground grid list-disc gap-1 pl-4 text-xs">
          <li>
            Cada activo vale lo que valía el último día del año: su cotización
            de ese día o la última de esa semana; sin cotización, el precio de
            su última operación.
          </li>
          <li>
            Lo que está en dólares se pasa a pesos al dólar oficial comprador
            del Banco Nación de ese día.
          </li>
          <li>
            Contamos como exentos los plazos fijos y los bonos (títulos públicos
            y obligaciones negociables). El efectivo, los CEDEARs, los FCIs, la
            cripto y los inmuebles cuentan como gravados; si tu efectivo está en
            un banco argentino puede estar exento.
          </li>
          {!placementKinds && (
            <li>
              Toda colocación a tasa cuenta como plazo fijo, así que va como
              exenta. Si tenés una caución o un préstamo otorgado, sumalo a mano
              a lo gravado.
            </li>
          )}
          <li>
            Los inmuebles y otros activos van al valor que cargaste, no a su
            valuación fiscal. El efectivo y los plazos fijos de años pasados van
            con el monto de hoy, porque no tienen historia.
          </li>
          <li>No restamos deudas ni calculamos el impuesto a pagar.</li>
        </ul>
      </section>

      <section className="grid gap-3" aria-labelledby={`${id}-gains`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id={`${id}-gains`} className="text-base font-semibold">
            Ganancias
          </h2>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="print:hidden"
            onClick={() => download(1)}
          >
            <Download />
            Bajar CSV
          </Button>
        </div>
        <dl className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <SummaryTile
            label={`Resultados de ${report.year}`}
            note="Ventas, dividendos, cupones y rendimientos"
          >
            <ResultText amount={gains.total} share={null} unit="ars" />
          </SummaryTile>
        </dl>
        {gains.groups.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No hubo ventas ni rentas en {report.year}.
          </p>
        ) : (
          <DataTable
            caption={`Resultados de ${report.year}`}
            columns={gainsColumns}
            data={gains.groups.map((group) => ({ ...group, id: group.kind }))}
          />
        )}
        <ul className="text-muted-foreground grid list-disc gap-1 pl-4 text-xs">
          <li>
            Cada venta resta el costo de las unidades más viejas (FIFO) y sus
            gastos.
          </li>
          <li>
            Cada movimiento se pasa a pesos al dólar de su día, y las rentas van
            antes de retenciones.
          </li>
          <li>
            No separamos lo exento de lo gravado ni aplicamos deducciones: eso
            depende de cada activo y de tu situación.
          </li>
        </ul>
      </section>

      {(!wealth.complete || !gains.complete) && (
        <p className="text-muted-foreground text-xs">
          Faltó algún dato: un activo sin cotización ese día, el dólar
          comprador, o un movimiento que no se puede pasar a pesos. Los totales
          dejan afuera lo que no tiene valor.
        </p>
      )}
      {report.leftOut > 0 && (
        <p className="text-muted-foreground text-xs">
          {report.leftOut === 1
            ? "Dejaste 1 activo fuera del reporte impositivo."
            : `Dejaste ${report.leftOut} activos fuera del reporte impositivo.`}{" "}
          {assetExclusion
            ? "Lo cambiás en la cuenta o en el activo."
            : "Lo cambiás en la cuenta."}
        </p>
      )}
    </div>
  );
}
