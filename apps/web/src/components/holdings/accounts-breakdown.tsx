"use client";

import type { Denominator } from "@plant/core";
import type { ColumnDef } from "@tanstack/react-table";

import { InstitutionIcon } from "@/components/portfolio-setup/institution-field";
import { DataTable, TruncatedText } from "@/components/ui/data-table";
import { TableCell, TableRow } from "@/components/ui/table";
import type { HoldingRow } from "@/lib/holdings/read";
import type { Breakdown, HoldingKind } from "@/lib/holdings/valuation-view";

import { type BreakdownLine, breakdownLines } from "./breakdown-lines";
import { NameLink } from "./holding-cells";
import {
  NUMBER_CELL,
  PendingSum,
  VALUE_CELL,
  holdingsCountText,
} from "./sum-text";

type AccountLine = BreakdownLine<HoldingRow["account"]>;

const PARTS: {
  kind: HoldingKind | "total";
  header: string;
  className: string;
}[] = [
  {
    kind: "cash",
    header: "Efectivo",
    className: `hidden @2xl:table-cell ${NUMBER_CELL}`,
  },
  {
    kind: "investments",
    header: "Inversiones",
    className: `hidden @2xl:table-cell ${NUMBER_CELL}`,
  },
  {
    kind: "other",
    header: "Otros",
    className: `hidden @3xl:table-cell ${NUMBER_CELL}`,
  },
  {
    kind: "total",
    header: "Total",
    className: VALUE_CELL,
  },
];

// Each account's shown holdings, split by kind, and the whole's.
export function AccountsBreakdown({
  rows,
  accounts,
  whole,
  unit,
  pending,
  href,
}: {
  rows: readonly HoldingRow[];
  accounts: Record<string, Breakdown>;
  whole: Breakdown;
  unit: Denominator;
  pending: boolean;
  href?: (id: string) => string;
}) {
  const columns: ColumnDef<AccountLine>[] = [
    {
      id: "account",
      header: "Cuenta",
      cell: ({ row: { original: line } }) => (
        <span className="flex min-w-0 items-center gap-2">
          <InstitutionIcon name={line.institution} />
          <span className="min-w-0">
            <NameLink
              className="font-medium"
              text={line.institution}
              href={href?.(line.id)}
            />
            <TruncatedText
              className="text-muted-foreground text-xs"
              text={holdingsCountText(line.count)}
            />
          </span>
        </span>
      ),
    },
    ...PARTS.map(({ kind, header, className }): ColumnDef<AccountLine> => ({
      id: kind,
      header,
      meta: { className },
      cell: ({ row: { original: line } }) => (
        <PendingSum
          sum={accounts[line.id]?.[kind]}
          unit={unit}
          pending={pending}
        />
      ),
    })),
  ];

  return (
    <DataTable
      columns={columns}
      data={breakdownLines(
        rows,
        (row) => row.account,
        (id) => accounts[id]?.total.value,
      )}
      caption="Valor por cuenta"
      footer={
        <TableRow>
          <TableCell>Total</TableCell>
          {PARTS.map(({ kind, className }) => (
            <TableCell key={kind} className={className}>
              <PendingSum sum={whole[kind]} unit={unit} pending={pending} />
            </TableCell>
          ))}
        </TableRow>
      }
    />
  );
}
