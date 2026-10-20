"use client";

import {
  type ColumnDef,
  type ColumnDefTemplate,
  type RowData,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { type LucideIcon, MoreHorizontal } from "lucide-react";
import type * as React from "react";
import { useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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

// Lists longer than this, such as an account's cash after years of imports,
// draw only the rows in view.
const VIRTUAL_FROM = 200;
// A row of one line, as the virtual list guesses it until it measures one.
const ROW_HEIGHT = 41;

// Rows in the order given. The columns with no `size` share the width the
// sized ones leave; the table sits in a container, so a column can respond to
// the table's width with `@`-variants. `footer` is one more row after the
// body, such as a total.
function DataTable<T extends DataTableRow>({
  columns,
  data,
  caption,
  footer,
}: {
  columns: ColumnDef<T>[];
  data: T[];
  caption: string;
  footer?: React.ReactNode;
}) {
  // TanStack keeps one table instance whose methods answer from the latest
  // data, which the compiler would memoize as if they could not change.
  "use no memo";
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

  // Past VIRTUAL_FROM rows only those in view, and a few around them, are
  // drawn; spacer rows keep the scroll height.
  const scroller = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: table.getRowModel().rows.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => ROW_HEIGHT,
    getItemKey: (index) => table.getRowModel().rows[index]?.id ?? index,
    overscan: 12,
    // A server render draws the rows of the box's first screen.
    initialRect: { width: 0, height: 512 },
  });
  const windowed = virtualizer.getVirtualItems();
  const before = windowed[0]?.start ?? 0;
  const after = virtualizer.getTotalSize() - (windowed.at(-1)?.end ?? 0);

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

  const rows = table.getRowModel().rows;
  const virtual = rows.length > VIRTUAL_FROM;

  return (
    <div
      ref={scroller}
      data-slot="data-table"
      className={cn(
        "@container overflow-hidden rounded-lg border",
        // A long list scrolls in its own box, which draws only the rows in
        // view.
        virtual && "max-h-[32rem] overflow-y-auto",
      )}
    >
      <Table className="table-fixed">
        <TableCaption className="sr-only">{caption}</TableCaption>
        <TableHeader
          className={cn(virtual && "bg-background sticky top-0 z-10")}
        >
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
          {virtual && before > 0 && (
            <tr aria-hidden style={{ height: before }} />
          )}
          {(virtual
            ? windowed.map((item) => ({ row: rows[item.index]!, item }))
            : rows.map((row) => ({ row, item: null }))
          ).map(({ row, item }) => (
            <TableRow
              key={row.id}
              ref={item ? virtualizer.measureElement : undefined}
              data-index={item?.index}
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
          {virtual && after > 0 && <tr aria-hidden style={{ height: after }} />}
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
  // The icon and tooltip for a row the action reads differently on.
  variant?: (row: T) => { icon: LucideIcon; tooltip: string } | undefined;
};

// A row's actions, right-aligned: up to two as icons, sized to their buttons
// (28px each, 4px apart, inside the cell's 12px side padding); three or more
// behind one ⋯ menu, with a delete last after a separator.
function actionsColumn<T>(
  actions: RowAction<T>[],
  { pending }: { pending: boolean },
): ColumnDef<T> {
  const menu = actions.length > 2;
  const shown = menu ? 1 : actions.length;
  return {
    id: ACTIONS_COLUMN,
    size: shown * 28 + (shown - 1) * 4 + 24,
    header: () => <span className="sr-only">Acciones</span>,
    cell: ({ row }) =>
      menu ? (
        <span className="flex justify-end">
          <RowActionsMenu
            actions={actions}
            row={row.original}
            pending={pending}
          />
        </span>
      ) : (
        <span className="flex justify-end gap-1">
          {actions.map((action) =>
            action.hidden?.(row.original) ? (
              <span key={action.id} aria-hidden className="size-7" />
            ) : (
              <IconButton
                key={action.id}
                actionId={action.id}
                icon={action.variant?.(row.original)?.icon ?? action.icon}
                tooltip={
                  action.variant?.(row.original)?.tooltip ?? action.tooltip
                }
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

// The ⋯ menu of a row with three or more actions. Its accessible name is the
// row's, taken from the first action's ("Editar IOL" names "IOL").
function RowActionsMenu<T>({
  actions,
  row,
  pending,
}: {
  actions: RowAction<T>[];
  row: T;
  pending: boolean;
}) {
  const shown = actions.filter((action) => !action.hidden?.(row));
  const destructive = shown.filter((action) => action.id === "delete");
  const rest = shown.filter((action) => action.id !== "delete");
  const first = actions[0]!;
  const name = first.label(row).slice(first.tooltip.length).trim();
  const item = (action: RowAction<T>) => {
    const Icon = action.variant?.(row)?.icon ?? action.icon;
    return (
      <DropdownMenuItem
        key={action.id}
        className={cn(
          "text-xs",
          action.id === "delete" && "text-destructive focus:text-destructive",
        )}
        onSelect={() => action.onClick(row)}
      >
        <Icon className={cn(action.id === "delete" && "text-destructive")} />
        {action.variant?.(row)?.tooltip ?? action.tooltip}
      </DropdownMenuItem>
    );
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={pending}>
        <Button
          variant="ghost"
          size="icon"
          data-action="menu"
          aria-label={`Acciones de ${name}`}
          className="text-muted-foreground hover:text-foreground size-7"
        >
          <MoreHorizontal className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {rest.map(item)}
        {destructive.length > 0 && rest.length > 0 && <DropdownMenuSeparator />}
        {destructive.map(item)}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// A row's action button, found by the row and action ids `actionsColumn`
// renders (or the row's ⋯ menu), so focus can return to it when the row comes
// back.
function rowActionButton(
  root: ParentNode,
  rowId: string,
  actionId: string,
): HTMLElement | null {
  const row = `tr[data-row-id="${CSS.escape(rowId)}"]`;
  return (
    root.querySelector<HTMLElement>(
      `${row} [data-action="${CSS.escape(actionId)}"]`,
    ) ?? root.querySelector<HTMLElement>(`${row} [data-action="menu"]`)
  );
}

export {
  DataTable,
  type DataTableRow,
  TruncatedText,
  actionsColumn,
  rowActionButton,
  type RowAction,
};
