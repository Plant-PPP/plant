"use client";

import { type Denominator, isTrade } from "@plant/core";
import { exactOf, plus, stored } from "@plant/shared";
import type { ColumnDef } from "@tanstack/react-table";

import { DataTable, TruncatedText } from "@/components/ui/data-table";
import { formatQuantity } from "@/lib/format/amount";
import { formatDate } from "@/lib/format/date";
import { tickerOf } from "@/lib/holdings/assets-filter";
import { formatQuotedPrice } from "@/lib/holdings/price-input";
import type { SaleLine } from "@/lib/holdings/movements-input";

import { AccountCell, TickerChip } from "./holding-cells";
import { AmountText, GainLossText, NUMBER_CELL } from "./sum-text";

type Row = SaleLine & { id: string };

// What a sale's parts sold together.
const quantityOf = (line: SaleLine): string =>
  stored(
    plus(
      ...line.movements.map((movement) =>
        exactOf(isTrade(movement) ? movement.quantity : "0"),
      ),
    ),
  );

const FIGURE = 112;

// The year's sales, newest first: what each sold, at what price, and what it
// made in the page's unit.
export function SalesTable({
  sales,
  unit,
  assetName,
}: {
  sales: SaleLine[];
  unit: Denominator;
  assetName: (row: SaleLine["row"]) => string;
}) {
  const inUnit = (value: string | undefined) => (
    <AmountText amount={value} unit={unit} />
  );
  const columns: ColumnDef<Row>[] = [
    {
      id: "date",
      header: "Fecha",
      size: 96,
      meta: { className: "tabular-nums" },
      cell: ({ row: { original } }) => formatDate(original.movements[0]!.date),
    },
    {
      id: "name",
      header: "Activo",
      cell: ({ row: { original } }) => (
        <TruncatedText text={assetName(original.row)} />
      ),
    },
    {
      id: "ticker",
      header: "Ticker",
      size: 96,
      meta: { className: "hidden @7xl:table-cell" },
      cell: ({ row: { original } }) => {
        const ticker = tickerOf(original.row);
        return ticker === null ? null : <TickerChip ticker={ticker} />;
      },
    },
    {
      id: "account",
      header: "Cuenta",
      size: 128,
      meta: { className: "hidden @4xl:table-cell text-muted-foreground" },
      cell: ({ row: { original } }) => (
        <AccountCell institution={original.row.account.institution} />
      ),
    },
    {
      id: "quantity",
      header: "Cantidad",
      size: FIGURE,
      meta: { className: `hidden @2xl:table-cell ${NUMBER_CELL}` },
      cell: ({ row: { original } }) => formatQuantity(quantityOf(original)),
    },
    {
      id: "price",
      header: "Precio",
      size: FIGURE,
      meta: { className: `hidden @3xl:table-cell ${NUMBER_CELL}` },
      cell: ({ row: { original } }) => {
        const [first] = original.movements;
        return first?.kind === "sale"
          ? formatQuotedPrice(
              first.price,
              first.currency,
              original.row.instrumentType,
            )
          : null;
      },
    },
    {
      id: "gross",
      header: "Bruto",
      size: FIGURE,
      meta: { className: `hidden @2xl:table-cell ${NUMBER_CELL}` },
      cell: ({ row: { original } }) => inUnit(original.sale?.gross),
    },
    {
      id: "charges",
      header: "Gastos",
      size: 96,
      meta: { className: `hidden @5xl:table-cell ${NUMBER_CELL}` },
      cell: ({ row: { original } }) => inUnit(original.sale?.charges),
    },
    {
      id: "cost",
      header: "Costo",
      size: FIGURE,
      meta: { className: `hidden @4xl:table-cell ${NUMBER_CELL}` },
      cell: ({ row: { original } }) => inUnit(original.sale?.cost),
    },
    {
      id: "result",
      header: "Resultado",
      size: FIGURE,
      meta: { className: `font-medium ${NUMBER_CELL}` },
      cell: ({ row: { original } }) => (
        <GainLossText
          gain={
            original.sale && { amount: original.sale.result, percent: null }
          }
          unit={unit}
        />
      ),
    },
  ];
  return (
    <DataTable
      columns={columns}
      data={sales.map((line) => ({ ...line, id: line.operationId }))}
      caption="Ventas"
    />
  );
}
