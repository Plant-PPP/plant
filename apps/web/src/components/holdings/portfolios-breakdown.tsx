"use client";

import type { Denominator } from "@plant/core";
import type { ColumnDef } from "@tanstack/react-table";

import { DataTable, TruncatedText } from "@/components/ui/data-table";
import { TableCell, TableRow } from "@/components/ui/table";
import type { HoldingRow } from "@/lib/holdings/read";
import type { Sum } from "@/lib/holdings/valuation-view";

import { type BreakdownLine, breakdownLines } from "./breakdown-lines";
import {
  NUMBER_CELL,
  PendingSum,
  ShareText,
  VALUE_CELL,
  holdingsCountText,
} from "./sum-text";

type PortfolioLine = BreakdownLine<HoldingRow["portfolio"]>;

// Each portfolio's shown holdings: their value and share of the whole.
export function PortfoliosBreakdown({
  rows,
  portfolios,
  total,
  unit,
  pending,
}: {
  rows: readonly HoldingRow[];
  portfolios: Record<string, Sum>;
  total: Sum;
  unit: Denominator;
  pending: boolean;
}) {
  const columns: ColumnDef<PortfolioLine>[] = [
    {
      id: "portfolio",
      header: "Cartera",
      cell: ({ row: { original: line } }) => (
        <>
          <TruncatedText className="font-medium" text={line.name} />
          <TruncatedText
            className="text-muted-foreground text-xs"
            text={holdingsCountText(line.count)}
          />
        </>
      ),
    },
    {
      id: "value",
      header: "Valor",
      meta: { className: VALUE_CELL },
      cell: ({ row: { original: line } }) => (
        <PendingSum sum={portfolios[line.id]} unit={unit} pending={pending} />
      ),
    },
    {
      id: "share",
      header: "%",
      size: 80,
      meta: { className: `text-muted-foreground ${NUMBER_CELL}` },
      cell: ({ row: { original: line } }) => (
        <ShareText
          share={portfolios[line.id]?.share}
          complete={(portfolios[line.id]?.complete ?? true) && total.complete}
        />
      ),
    },
  ];

  return (
    <DataTable
      columns={columns}
      data={breakdownLines(
        rows,
        (row) => row.portfolio,
        (id) => portfolios[id]?.value,
      )}
      caption="Valor por cartera"
      footer={
        <TableRow>
          <TableCell>Total</TableCell>
          <TableCell className={VALUE_CELL}>
            <PendingSum sum={total} unit={unit} pending={pending} />
          </TableCell>
          <TableCell />
        </TableRow>
      }
    />
  );
}
