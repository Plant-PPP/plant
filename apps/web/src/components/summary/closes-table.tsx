"use client";

import type { Denominator } from "@plant/core";
import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";

import {
  AmountText,
  NUMBER_CELL,
  VALUE_CELL,
} from "@/components/holdings/sum-text";
import { DataTable } from "@/components/ui/data-table";
import { TableCell, TableRow } from "@/components/ui/table";
import { type MonthClose, monthOf, type YearClose } from "@/lib/summary/closes";

import { CloseStatus, ResultText } from "./figures";

type Row = MonthClose & { id: string };

// A close that left out a holding without a price or a movement the unit
// cannot express, as its detail explains.
function PartialMark() {
  return (
    <span className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-xs">
      Parcial
    </span>
  );
}

// A year's monthly closes, newest first, with the year's sum as the footer.
export function ClosesTable({
  year,
  unit,
  href,
}: {
  year: YearClose;
  unit: Denominator;
  href: (period: string) => string;
}) {
  const columns: ColumnDef<Row>[] = [
    {
      id: "month",
      header: "Mes",
      cell: ({ row: { original: close } }) => (
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <Link
            href={href(close.period)}
            className="font-medium underline-offset-2 hover:underline"
          >
            {monthOf(close.period)}
          </Link>
          {(close.open || close.recalculatedOn) && (
            <CloseStatus close={close} />
          )}
          {!close.complete && <PartialMark />}
        </span>
      ),
    },
    {
      id: "contributed",
      header: "Aportes netos",
      size: 152,
      meta: { className: `hidden @2xl:table-cell ${NUMBER_CELL}` },
      cell: ({ row: { original: close } }) => (
        <AmountText amount={close.figures.contributed} unit={unit} />
      ),
    },
    {
      id: "result",
      header: "Resultado",
      size: 152,
      meta: { className: NUMBER_CELL },
      cell: ({ row: { original: close } }) => (
        <ResultText
          amount={close.figures.result}
          share={close.figures.share}
          unit={unit}
        />
      ),
    },
    {
      id: "end",
      header: "Patrimonio neto",
      meta: { className: VALUE_CELL },
      cell: ({ row: { original: close } }) => (
        <AmountText amount={close.figures.endValue} unit={unit} />
      ),
    },
  ];
  const { totals } = year;
  return (
    <DataTable
      caption={`Cierres de ${year.year}`}
      columns={columns}
      data={[...year.months]
        .reverse()
        .map((close) => ({ ...close, id: close.period }))}
      footer={
        <TableRow>
          <TableCell>
            <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <Link
                href={href(year.year)}
                className="font-medium underline-offset-2 hover:underline"
              >
                {`Total ${year.year}`}
              </Link>
              {!year.complete && <PartialMark />}
            </span>
          </TableCell>
          <TableCell className={`hidden @2xl:table-cell ${NUMBER_CELL}`}>
            <AmountText amount={totals.contributed} unit={unit} />
          </TableCell>
          <TableCell className={NUMBER_CELL}>
            <ResultText
              amount={totals.result}
              share={totals.share}
              unit={unit}
            />
          </TableCell>
          <TableCell className={VALUE_CELL}>
            <AmountText amount={totals.endValue} unit={unit} />
          </TableCell>
        </TableRow>
      }
    />
  );
}
