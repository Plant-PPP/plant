"use client";

import {
  type ColumnDef,
  type ColumnDefTemplate,
  type RowData,
  getCoreRowModel,
  getExpandedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { ChevronRight, type LucideIcon } from "lucide-react";
import { Fragment, useEffect, useRef, useState } from "react";
import type * as React from "react";
import { IconButton } from "@/components/ui/icon-button";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
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
const EXPAND_COLUMN = "expand";

// Rows in the order given. The columns with no `size` share the width the
// sized ones leave; the table sits in a container, so a column can respond to
// the table's width with `@`-variants. `footer` is one more row after the
// body, such as a total. A row `expandable` says opens under itself to what
// `renderExpanded` renders, through `expandColumn`'s button.
function DataTable<T extends DataTableRow>({
  columns,
  data,
  caption,
  footer,
  expandable,
  renderExpanded,
}: {
  columns: ColumnDef<T>[];
  data: T[];
  caption: string;
  footer?: React.ReactNode;
  expandable?: (row: T) => boolean;
  renderExpanded?: (row: T) => React.ReactNode;
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
    getExpandedRowModel: getExpandedRowModel(),
    getRowCanExpand: (row) => expandable?.(row.original) ?? false,
    getRowId: (row) => row.id,
  });

  // Column names only help when several columns show side by side: a list of
  // one column, or a table below @2xl (its secondary columns use
  // `hidden @2xl:table-cell` and fold into the first), keeps its header row
  // out of view, and the caption names it. visibility: collapse keeps the
  // fixed layout's column widths, which the header cells set; the row's
  // border would still paint, so it goes too.
  const dataColumns = columns.filter(
    (column) => column.id !== ACTIONS_COLUMN && column.id !== EXPAND_COLUMN,
  );
  const headerRowClass =
    dataColumns.length > 1
      ? "@max-2xl:collapse @max-2xl:border-b-0!"
      : "collapse border-b-0!";

  const headerRow = useRef<HTMLTableRowElement>(null);
  const shownColumns = useShownColumns(headerRow, renderExpanded !== undefined);

  return (
    <div data-slot="data-table" className="@container rounded-md border">
      <Table className="table-fixed">
        <TableCaption className="sr-only">{caption}</TableCaption>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow
              key={headerGroup.id}
              ref={headerRow}
              className={headerRowClass}
            >
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
            <Fragment key={row.id}>
              <TableRow
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
              {row.getIsExpanded() && renderExpanded && (
                <TableRow className="bg-muted/30 hover:bg-muted/30">
                  <TableCell
                    id={expandedId(row.id)}
                    colSpan={shownColumns ?? row.getVisibleCells().length}
                    className="p-3"
                  >
                    {renderExpanded(row.original)}
                  </TableCell>
                </TableRow>
              )}
            </Fragment>
          ))}
        </TableBody>
        {footer && <TableFooter>{footer}</TableFooter>}
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
  // A row the action does not apply to keeps its place empty, so the
  // buttons line up.
  hidden?: (row: T) => boolean;
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
        {actions.map((action) =>
          action.hidden?.(row.original) ? (
            <span key={action.id} aria-hidden className="size-7" />
          ) : (
            <IconButton
              key={action.id}
              actionId={action.id}
              icon={action.icon}
              tooltip={action.tooltip}
              label={action.label(row.original)}
              pending={pending}
              onClick={() => action.onClick(row.original)}
            />
          ),
        )}
      </span>
    ),
  };
}

const expandedId = (rowId: string) => `expanded-${rowId}`;

// How many columns the table shows at its width: its secondary columns hide
// with CSS, and an expanded row spanning more columns than show would add
// empty ones that squeeze the rest.
function useShownColumns(
  headerRow: React.RefObject<HTMLTableRowElement | null>,
  enabled: boolean,
): number | null {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    const row = headerRow.current;
    if (!enabled || !row) return;
    const measure = () =>
      setCount(
        [...row.children].filter(
          (cell) => getComputedStyle(cell).display !== "none",
        ).length,
      );
    const observer = new ResizeObserver(measure);
    observer.observe(row.closest("table") ?? row);
    return () => observer.disconnect();
  }, [headerRow, enabled]);
  return count;
}

// The button that opens a row `expandable` says, first in its row.
function expandColumn<T>({
  label,
}: {
  label: (row: T) => string;
}): ColumnDef<T> {
  return {
    id: EXPAND_COLUMN,
    size: 40,
    header: () => <span className="sr-only">Abrir</span>,
    meta: { className: "pr-0" },
    cell: ({ row }) =>
      row.getCanExpand() ? (
        <button
          type="button"
          aria-expanded={row.getIsExpanded()}
          aria-controls={row.getIsExpanded() ? expandedId(row.id) : undefined}
          aria-label={label(row.original)}
          onClick={row.getToggleExpandedHandler()}
          className="text-muted-foreground hover:text-foreground focus-visible:ring-ring grid size-7 place-items-center rounded-md outline-none focus-visible:ring-2"
        >
          <ChevronRight
            aria-hidden
            className={cn(
              "size-4 transition-transform",
              row.getIsExpanded() && "rotate-90",
            )}
          />
        </button>
      ) : null,
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
  expandColumn,
  rowActionButton,
};
