"use client";

import {
  type Denominator,
  type InstrumentType,
  isTrade,
  type MovementCursor,
} from "@plant/core";
import type { ColumnDef } from "@tanstack/react-table";
import type { LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { FormAlert } from "@/components/ui/form-alert";
import {
  DataTable,
  TruncatedText,
  actionsColumn,
} from "@/components/ui/data-table";
import { formatQuantity } from "@/lib/format/amount";
import { formatDate } from "@/lib/format/date";
import { MOVEMENT_KIND_LABELS } from "@/lib/holdings/messages";
import { formatQuotedPrice } from "@/lib/holdings/price-input";
import type {
  MovementLine,
  MovementScope,
  MovementsInput,
} from "@/lib/holdings/movements-input";
import { settle } from "@/lib/server-action-call";

import { AmountText, NUMBER_CELL } from "./sum-text";

type Row = MovementLine & { id: string };

type Loaded =
  | { kind: "loading"; rows: Row[] }
  | { kind: "ready"; rows: Row[]; next: MovementCursor | null }
  | { kind: "failed"; rows: Row[]; retry: MovementCursor | null };

export type MovementRowAction = {
  id: string;
  icon: LucideIcon;
  tooltip: string;
  label: (line: MovementLine) => string;
  onClick: (line: MovementLine) => void;
};

const money = (value: string | null | undefined, unit: Denominator) => (
  <AmountText amount={value} unit={unit} />
);

// A scope's movements, newest first, in the page's unit, a page at a time.
// The caller keys it by scope, unit and the scope's revision, so a change
// reads it again from the top.
export function MovementsTable({
  scope,
  unit,
  load,
  holdingName,
  instrumentTypes,
  limit,
  actions = [],
  pending = false,
}: {
  scope: MovementScope;
  unit: Denominator;
  load: MovementsInput["loadMovements"];
  // Names each row's holding; a list of one holding's movements has none.
  holdingName?: (holdingId: string) => string;
  // Each instrument's type by symbol, so a bond's price shows per 100
  // nominal as quoted.
  instrumentTypes?: ReadonlyMap<string, InstrumentType>;
  // Shows only the newest `limit`, with no more to page.
  limit?: number;
  actions?: MovementRowAction[];
  pending?: boolean;
}) {
  const [loaded, setLoaded] = useState<Loaded>({ kind: "loading", rows: [] });

  // Reads the page after `cursor` and shows it after `rows`.
  function fetchPage(cursor: MovementCursor | null, rows: Row[]) {
    let cancelled = false;
    void settle(load(scope, unit, cursor)).then((page) => {
      if (cancelled) return;
      if (page === "rejected" || !page.ok) {
        setLoaded({ kind: "failed", rows, retry: cursor });
        return;
      }
      const shown = [
        ...rows,
        ...page.rows.map((line) => ({ ...line, id: line.movement.id })),
      ];
      setLoaded({
        kind: "ready",
        rows: limit === undefined ? shown : shown.slice(0, limit),
        next: limit === undefined ? page.next : null,
      });
    });
    return () => {
      cancelled = true;
    };
  }

  function read(cursor: MovementCursor | null, rows: Row[]) {
    setLoaded({ kind: "loading", rows });
    fetchPage(cursor, rows);
  }

  // The first page, once; the caller's key reads it again.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => fetchPage(null, []), []);

  const columns: ColumnDef<Row>[] = [
    {
      id: "date",
      header: "Fecha",
      size: 96,
      meta: { className: "tabular-nums" },
      cell: ({ row: { original } }) => formatDate(original.movement.date),
    },
    ...(holdingName
      ? [
          {
            id: "holding",
            header: "Activo",
            cell: ({ row: { original } }: { row: { original: Row } }) => (
              <TruncatedText text={holdingName(original.movement.holding_id)} />
            ),
          } satisfies ColumnDef<Row>,
        ]
      : []),
    {
      id: "kind",
      header: "Tipo",
      size: 112,
      cell: ({ row: { original } }) =>
        MOVEMENT_KIND_LABELS[original.movement.kind],
    },
    {
      id: "quantity",
      header: "Cantidad",
      meta: { className: `hidden @2xl:table-cell ${NUMBER_CELL}` },
      cell: ({ row: { original } }) =>
        isTrade(original.movement)
          ? formatQuantity(original.movement.quantity)
          : null,
    },
    {
      id: "price",
      header: "Precio",
      meta: { className: `hidden @2xl:table-cell ${NUMBER_CELL}` },
      cell: ({ row: { original } }) =>
        isTrade(original.movement)
          ? formatQuotedPrice(
              original.movement.price,
              original.movement.currency,
              instrumentTypes?.get(original.operation.instrument),
            )
          : null,
    },
    {
      id: "cost",
      header: "Importe",
      meta: { className: NUMBER_CELL },
      cell: ({ row: { original } }) => money(original.amount, unit),
    },
    {
      id: "charges",
      header: "Gastos",
      meta: { className: `hidden @3xl:table-cell ${NUMBER_CELL}` },
      cell: ({ row: { original } }) => money(original.charges, unit),
    },
    ...(actions.length > 0 ? [actionsColumn<Row>(actions, { pending })] : []),
  ];

  return (
    <div className="grid gap-2">
      {loaded.rows.length > 0 && (
        <DataTable columns={columns} data={loaded.rows} caption="Movimientos" />
      )}
      {loaded.kind === "loading" && (
        <p role="status" className="text-sm text-muted-foreground">
          Cargando movimientos…
        </p>
      )}
      {loaded.kind === "ready" && loaded.rows.length === 0 && (
        <p className="text-sm text-muted-foreground">Sin movimientos.</p>
      )}
      {loaded.kind === "failed" && (
        <FormAlert>
          No pudimos cargar los movimientos.{" "}
          <Button
            variant="link"
            className="h-auto p-0"
            onClick={() => read(loaded.retry, loaded.rows)}
          >
            Reintentar
          </Button>
        </FormAlert>
      )}
      {loaded.kind === "ready" && loaded.next && (
        <div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => read(loaded.next, loaded.rows)}
          >
            Ver más
          </Button>
        </div>
      )}
    </div>
  );
}
