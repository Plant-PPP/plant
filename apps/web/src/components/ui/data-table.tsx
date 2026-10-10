"use client";

import {
  type ColumnDef,
  type ColumnDefTemplate,
  type RowData,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import type { LucideIcon } from "lucide-react";
import type * as React from "react";
import { IconButton } from "@/components/ui/icon-button";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

declare module "@tanstack/react-table" {
  // A merged declaration must repeat the library's type parameters.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    // Classes for the column's header and body cells.
    className?: string;
  }
}

// A header or cell is called as a function, not mounted as a component: its
// callers rebuild their columns on every render, and as components each new
// function would remount its cell, replacing the button a dialog returns focus
// to. So a header or cell must not call hooks; one that needs them renders a
// component instead (`cell: (context) => <Cell {...context} />`).
function slot<P extends object>(
  template: ColumnDefTemplate<P> | undefined,
  props: P,
): React.ReactNode {
  return typeof template === "function" ? template(props) : template;
}

// A row of a DataTable. `unsaved` marks a row the page shows before the
// server has confirmed it.
type DataTableRow = { id: string; unsaved?: true };

const ACTIONS_COLUMN = "actions";

// Rows in the order given. The columns with no `size` share the width the
// sized ones leave; the table sits in a container, so a column can respond to
// the table's width with `@`-variants.
function DataTable<T extends DataTableRow>({
  columns,
  data,
  caption,
}: {
  columns: ColumnDef<T>[];
  data: T[];
  caption: string;
}) {
  // The app has no React Compiler, and nothing memoizes the table instance.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data,
    columns,
    // TanStack gives every column a 150px size by default; cleared, so a
    // column without `size` stays the flexible one.
    defaultColumn: { size: undefined },
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => row.id,
  });

  // Column names only help when several columns show side by side: a list of
  // one column, or a table below @2xl (its secondary columns use
  // `hidden @2xl:table-cell` and fold into the first), keeps its header row
  // out of view, and the caption names it. visibility: collapse keeps the
  // fixed layout's column widths, which the header cells set; the row's
  // border would still paint, so it goes too.
  const dataColumns = columns.filter((column) => column.id !== ACTIONS_COLUMN);
  const headerRowClass =
    dataColumns.length > 1
      ? "@max-2xl:collapse @max-2xl:border-b-0!"
      : "collapse border-b-0!";

  return (
    <div data-slot="data-table" className="@container rounded-md border">
      <Table className="table-fixed">
        <TableCaption className="sr-only">{caption}</TableCaption>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id} className={headerRowClass}>
              {headerGroup.headers.map((header) => (
                <TableHead
                  key={header.id}
                  className={header.column.columnDef.meta?.className}
                  style={
                    header.column.columnDef.size === undefined
                      ? undefined
                      : { width: header.column.columnDef.size }
                  }
                >
                  {header.isPlaceholder
                    ? null
                    : slot(header.column.columnDef.header, header.getContext())}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.map((row) => (
            <TableRow
              key={row.id}
              data-row-id={row.id}
              aria-busy={row.original.unsaved || undefined}
              className={row.original.unsaved ? "opacity-60" : undefined}
            >
              {row.getVisibleCells().map((cell) => (
                <TableCell
                  key={cell.id}
                  className={cell.column.columnDef.meta?.className}
                >
                  {slot(cell.column.columnDef.cell, cell.getContext())}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function TruncatedText({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  return (
    <span className={cn("block truncate", className)} title={text}>
      {text}
    </span>
  );
}

type RowAction<T> = {
  id: string;
  icon: LucideIcon;
  tooltip: string;
  label: (row: T) => string;
  onClick: (row: T) => void;
};

// A row's icon actions, right-aligned. Sized to its buttons: each IconButton
// is 28px, 4px apart, inside the cell's 12px side padding.
function actionsColumn<T>(
  actions: RowAction<T>[],
  { pending }: { pending: boolean },
): ColumnDef<T> {
  return {
    id: ACTIONS_COLUMN,
    size: actions.length * 28 + (actions.length - 1) * 4 + 24,
    header: () => <span className="sr-only">Acciones</span>,
    cell: ({ row }) => (
      <span className="flex justify-end gap-1">
        {actions.map((action) => (
          <IconButton
            key={action.id}
            actionId={action.id}
            icon={action.icon}
            tooltip={action.tooltip}
            label={action.label(row.original)}
            pending={pending}
            onClick={() => action.onClick(row.original)}
          />
        ))}
      </span>
    ),
  };
}

// A row's action button, found by the row and action ids `actionsColumn`
// renders, so focus can return to it when the row comes back.
function rowActionButton(
  root: ParentNode,
  rowId: string,
  actionId: string,
): HTMLElement | null {
  return root.querySelector<HTMLElement>(
    `tr[data-row-id="${CSS.escape(rowId)}"] [data-action="${CSS.escape(actionId)}"]`,
  );
}

export {
  DataTable,
  type DataTableRow,
  TruncatedText,
  actionsColumn,
  rowActionButton,
};
