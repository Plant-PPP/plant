"use client";

import type { Denominator } from "@plant/core";
import type { Currency } from "@plant/shared";
import type { ColumnDef } from "@tanstack/react-table";

import {
  NUMBER_CELL,
  PendingSum,
  ShareText,
  VALUE_CELL,
} from "@/components/holdings/sum-text";
import { DataTable } from "@/components/ui/data-table";
import { TableCell, TableRow } from "@/components/ui/table";
import type { Sum } from "@/lib/holdings/valuation-view";

const CURRENCY_NAMES: Record<Currency, string> = {
  ARS: "En pesos",
  USD: "En dólares",
  EUR: "En euros",
};

type Line = { id: Currency; sum: Sum };

// What is held in each currency, valued in the page's unit, with its share
// of the whole, marked when the currency or the whole leaves holdings out.
export function CurrenciesBreakdown({
  currencies,
  total,
  unit,
}: {
  currencies: Partial<Record<Currency, Sum>>;
  total: Sum;
  unit: Denominator;
}) {
  const lines = (Object.keys(CURRENCY_NAMES) as Currency[]).flatMap(
    (currency): Line[] => {
      const sum = currencies[currency];
      return sum && sum.count > 0 ? [{ id: currency, sum }] : [];
    },
  );
  const columns: ColumnDef<Line>[] = [
    {
      id: "currency",
      header: "Moneda",
      cell: ({ row: { original: line } }) => (
        <span className="font-medium">{CURRENCY_NAMES[line.id]}</span>
      ),
    },
    {
      id: "value",
      header: "Valor",
      meta: { className: VALUE_CELL },
      cell: ({ row: { original: line } }) => (
        <PendingSum sum={line.sum} unit={unit} pending={false} />
      ),
    },
    {
      id: "share",
      header: "%",
      size: 80,
      meta: { className: `text-muted-foreground ${NUMBER_CELL}` },
      cell: ({ row: { original: line } }) => (
        <ShareText
          share={line.sum.share}
          complete={line.sum.complete && total.complete}
        />
      ),
    },
  ];
  return (
    <DataTable
      columns={columns}
      data={lines}
      caption="Valor por moneda"
      footer={
        <TableRow>
          <TableCell>Total</TableCell>
          <TableCell className={VALUE_CELL}>
            <PendingSum sum={total} unit={unit} pending={false} />
          </TableCell>
          <TableCell />
        </TableRow>
      }
    />
  );
}
