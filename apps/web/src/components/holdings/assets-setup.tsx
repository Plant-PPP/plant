"use client";

import {
  allowedKinds,
  type Denominator,
  type Movement,
  type Position,
  takesMovements,
} from "@plant/core";
import { compareDecimals } from "@plant/shared";
import type { ColumnDef } from "@tanstack/react-table";
import {
  Archive,
  ArchiveRestore,
  ArrowLeftRight,
  Pencil,
  Plus,
} from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { dialogAnswer } from "@/components/portfolio-setup/answers";
import {
  applyChange,
  type ListChange,
  temporaryId,
} from "@/components/portfolio-setup/list-change";
import { useOptimisticWrites } from "@/components/portfolio-setup/optimistic-writes";
import {
  ArchivedList,
  type Retry,
  SetupCard,
  useSetupCard,
} from "@/components/portfolio-setup/setup-card";
import {
  DataTable,
  TruncatedText,
  actionsColumn,
  expandColumn,
} from "@/components/ui/data-table";
import { PendingButton } from "@/components/ui/pending-button";
import { TableCell, TableRow } from "@/components/ui/table";
import { formatAmount, formatPrice, formatQuantity } from "@/lib/format/amount";
import { formatDate } from "@/lib/format/date";
import {
  type AssetsFilter,
  type AssetsTab,
  type SALES_TABS,
  type TABS,
  tabOf,
  matchesFilter,
  tickerOf,
} from "@/lib/holdings/assets-filter";
import { holdingName, instrumentNames } from "@/lib/holdings/holding-name";
import {
  ASSET_CLASS_LABELS,
  MOVEMENT_KIND_LABELS,
  MOVEMENT_MESSAGES,
} from "@/lib/holdings/messages";
import { averageCost, costTotals, gainLoss } from "@/lib/holdings/cost-totals";
import type {
  MovementResult,
  MovementsInput,
} from "@/lib/holdings/movements-input";
import type {
  HoldingRow,
  HoldingsView,
  InstrumentRow,
} from "@/lib/holdings/read";
import {
  type HoldingsValuation,
  hasUnitPrice,
} from "@/lib/holdings/valuation-view";
import { PAGE_ROW_LIMIT, SALES_LIMIT } from "@/lib/portfolio-setup/limits";
import { WRITE_MESSAGES } from "@/lib/portfolio-setup/messages";
import type {
  PortfolioRow,
  SourceConnectionRow,
} from "@/lib/portfolio-setup/read";
import type { WriteResult } from "@/lib/portfolio-setup/write-result";
import type { KeysetParams } from "@/lib/supabase/keyset";

import { InstitutionIcon } from "@/components/portfolio-setup/institution-field";

import { AccountsBreakdown } from "./accounts-breakdown";
import { AssetsFilters } from "./assets-filters";
import { AssetsSummary } from "./assets-summary";
import { type ChosenHolding, HoldingDialog } from "./holding-dialog";
import {
  type HoldingFields,
  holdingRow,
  initialFields,
  toInsert,
  toUpdate,
} from "./holding-fields";
import { AssetsTabs, panelId, tabId } from "./assets-tabs";
import { AccountCell, TickerChip } from "./holding-cells";
import { useAssetsUrl } from "./assets-url";
import { PortfoliosBreakdown } from "./portfolios-breakdown";
import { MovementDialog } from "./movement-dialog";
import {
  initialMovementFields,
  type MovementFields,
  toMovementInput,
} from "./movement-fields";
import { MovementsTable } from "./movements-table";
import { SalesSummary } from "./sales-summary";
import { SalesTable } from "./sales-table";
import {
  CALCULATING,
  GainLossText,
  MissingFigure,
  NO_QUOTE,
  NUMBER_CELL,
  PendingSum,
  ShareText,
} from "./sum-text";

const MESSAGES = WRITE_MESSAGES.holdings;

// The width of each figure the movements add, and of the quantity beside them.
const MOVEMENT_FIGURE = 112;

type ShownHolding = HoldingRow & { unsaved?: true };

type MovementDialogState =
  | ({ kind: "create"; holdingId: string | null } & Retry<MovementFields>)
  | ({ kind: "edit"; movement: Movement } & Retry<MovementFields>);

type DialogState =
  | ({ kind: "create" } & Retry<HoldingFields>)
  | ({ kind: "edit"; row: HoldingRow } & Retry<HoldingFields>);

// What a holding is: its quantity or amount, in its own unit.
function heldAmount({ holding }: HoldingRow): string {
  return holding.asset_class === "instrument"
    ? `${formatQuantity(holding.amount)} ${holding.instrument_symbol}`
    : formatAmount(holding.amount, holding.currency);
}

// What the screen's writes call. A page whose holdings can be archived passes
// archiving; the page without it lists no archived holdings.
export type HoldingActions = {
  create: (input: unknown) => Promise<WriteResult>;
  update: (id: string, input: unknown) => Promise<WriteResult>;
  archiving?: {
    archive: (id: string) => Promise<WriteResult>;
    restore: (id: string) => Promise<WriteResult>;
  };
};

export type MovementActions = {
  create: (input: unknown) => Promise<MovementResult>;
  update: (id: string, input: unknown) => Promise<MovementResult>;
};

// A page offers the sales tab exactly when it passes movements.
type MovementProps =
  | {
      tabs: typeof TABS & { sales?: never };
      movements?: undefined;
      movementActions?: undefined;
    }
  | {
      tabs: typeof SALES_TABS;
      movements: MovementsInput;
      movementActions: MovementActions;
    };

export function AssetsSetup({
  holdings,
  valuation,
  unit,
  referenceUnit,
  filter,
  params,
  accounts,
  portfolios,
  instruments,
  today,
  tabs,
  actions,
  movements,
  movementActions,
}: {
  holdings: HoldingsView;
  valuation: HoldingsValuation;
  unit: Denominator;
  referenceUnit: Denominator;
  filter: AssetsFilter;
  params: KeysetParams;
  accounts: SourceConnectionRow[];
  portfolios: PortfolioRow[];
  instruments: InstrumentRow[];
  today: string;
  actions: HoldingActions;
} & MovementProps) {
  const {
    shown: view,
    pending,
    run,
  } = useOptimisticWrites(holdings, (state, change: ListChange<HoldingRow>) =>
    applyChange(state, change),
  );
  const card = useSetupCard({ run, pending });
  const url = useAssetsUrl(params);
  // The tab shows at once; its data is already on the page.
  const tab = tabOf(url.params.tab, tabs);
  const { archiving } = actions;
  // The movement columns, rows and tab, for a page that passes movements.
  const movement = movements &&
    movementActions && { input: movements, actions: movementActions };
  const tabsId = useId();
  const router = useRouter();
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [movementDialog, setMovementDialog] =
    useState<MovementDialogState | null>(null);
  const names = instrumentNames(instruments);
  const name = (row: HoldingRow) => holdingName(row.holding, names);
  // What the table calls an asset: an instrument by its name, beside its
  // ticker.
  const assetName = ({ holding }: HoldingRow) =>
    holding.asset_class === "instrument"
      ? (names.get(holding.instrument_symbol) ?? holding.instrument_symbol)
      : holdingName(holding, names);
  // A holding as actions and their answers name it: the same instrument can
  // sit in several accounts and portfolios.
  const named = (row: HoldingRow) =>
    `${name(row)} de ${row.account.institution} en ${row.portfolio.name}`;

  function openDialog(next: DialogState) {
    if (pending) return;
    if (next.kind === "create" && accounts.length === 0) {
      toast.error("Primero agregá una cuenta en Cuentas.", {
        action: {
          label: "Ir a Cuentas",
          onClick: () => router.push("/accounts"),
        },
      });
      return;
    }
    setDialog(next);
  }

  function rowAction(
    change: ListChange<HoldingRow>,
    call: () => Promise<WriteResult>,
    row: HoldingRow,
    actionId: "archive" | "restore",
    done: string,
  ) {
    card.rowAction(change, call, (result) => dialogAnswer(result, MESSAGES), {
      done: `${done} ${named(row)}`,
      rowId: row.id,
      actionId,
    });
  }

  function submit(
    dialog: DialogState,
    fields: HoldingFields,
    change: ListChange<HoldingRow>,
    call: () => Promise<WriteResult>,
    done: string,
    row: HoldingRow,
  ): boolean {
    return card.dialogAction(change, call, MESSAGES, {
      done: `${done} ${named(row)}`,
      reopen: (error) =>
        setDialog({ ...dialog, initial: fields, initialError: error }),
    });
  }

  // The instrument holdings a movement can be recorded for.
  const movementHoldings = view.active.flatMap((row) =>
    takesMovements(row.holding) && !("unsaved" in row && row.unsaved)
      ? [
          {
            id: row.id,
            name: named(row),
            hasMovements: movement?.input.positions.has(row.id) ?? false,
            row,
          },
        ]
      : [],
  );

  function openMovementDialog(next: MovementDialogState) {
    if (pending) return;
    if (next.kind === "create" && movementHoldings.length === 0) {
      toast.error("Primero agregá una tenencia de un instrumento.");
      return;
    }
    setMovementDialog(next);
  }

  // A new movement's fields: today, the holding's first allowed kind, its
  // instrument's currency, and its amount as an opening balance's quantity.
  function newMovementFields(holdingId: string | null): MovementFields {
    const chosen =
      movementHoldings.find((each) => each.id === holdingId) ??
      movementHoldings[0]!;
    const [kind] = allowedKinds(chosen.hasMovements);
    const { holding } = chosen.row;
    const symbol =
      holding.asset_class === "instrument" ? holding.instrument_symbol : "";
    return initialMovementFields(null, {
      kind: kind!,
      holdingId: chosen.id,
      date: today,
      currency:
        instruments.find((each) => each.symbol === symbol)?.currency ?? "ARS",
      ...(kind === "opening_balance" && { quantity: holding.amount }),
    });
  }

  function submitMovement(
    state: MovementDialogState,
    actions: MovementActions,
    fields: MovementFields,
  ): boolean {
    const chosen = movementHoldings.find(
      (each) => each.id === fields.holdingId,
    );
    if (!chosen) return false;
    const input = toMovementInput(fields);
    return card.dialogAction(
      // The holding shows as saving until its movements are read again.
      { kind: "update", row: chosen.row },
      () =>
        state.kind === "edit"
          ? actions.update(state.movement.id, input)
          : actions.create(input),
      MOVEMENT_MESSAGES,
      {
        done:
          state.kind === "edit"
            ? `Guardaste el movimiento de ${chosen.name}`
            : `Agregaste un movimiento a ${chosen.name}`,
        reopen: (error) =>
          setMovementDialog({
            ...state,
            initial: fields,
            initialError: error,
          }),
      },
    );
  }

  // What the server valued for a row; nothing yet for one it has not saved.
  const valued = (row: ShownHolding) =>
    row.unsaved ? undefined : valuation.values[row.id];

  // A value carries the date of the oldest quote or valuation it used.
  const value = (row: ShownHolding) => {
    const item = valued(row);
    if (!item) return CALCULATING;
    if (item.value === null || item.asOf === null) {
      return <MissingFigure text={NO_QUOTE} />;
    }
    const asOf = formatDate(item.asOf);
    return (
      <span title={`Al ${asOf}`}>
        {formatAmount(item.value, unit)}
        <span className="sr-only">{`, al ${asOf}`}</span>
      </span>
    );
  };

  const columns: ColumnDef<ShownHolding>[] = [
    {
      id: "name",
      header: "Activo",
      cell: ({ row: { original: shown } }) => {
        const ticker = tickerOf(shown);
        return (
          <>
            <TruncatedText text={assetName(shown)} />
            <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground @2xl:hidden">
              <TruncatedText text={`${heldAmount(shown)} ·`} />
              <InstitutionIcon name={shown.account.institution} />
              <TruncatedText text={shown.account.institution} />
            </span>
            {ticker !== null && (
              <span className="sr-only @3xl:hidden">{`, ${ticker}`}</span>
            )}
          </>
        );
      },
    },
    {
      id: "ticker",
      header: "Ticker",
      size: 96,
      meta: {
        className: movement
          ? "hidden @7xl:table-cell"
          : "hidden @3xl:table-cell",
      },
      cell: ({ row: { original: row } }) => {
        const ticker = tickerOf(row);
        return ticker === null ? null : <TickerChip ticker={ticker} />;
      },
    },
    {
      id: "class",
      header: "Tipo",
      size: 104,
      meta: {
        className: `${movement ? "hidden @6xl:table-cell" : "hidden @4xl:table-cell"} text-muted-foreground`,
      },
      cell: ({ row: { original: row } }) => (
        <TruncatedText text={ASSET_CLASS_LABELS[row.holding.asset_class]} />
      ),
    },
    {
      id: "account",
      header: "Cuenta",
      size: movement ? 128 : 144,
      meta: { className: "hidden @2xl:table-cell text-muted-foreground" },
      cell: ({ row: { original: row } }) => (
        <AccountCell institution={row.account.institution} />
      ),
    },
    {
      id: "portfolio",
      header: "Cartera",
      size: 120,
      meta: {
        className: `${movement ? "hidden @7xl:table-cell" : "hidden @4xl:table-cell"} text-muted-foreground`,
      },
      cell: ({ row: { original: row } }) => (
        <TruncatedText text={row.portfolio.name} />
      ),
    },
    {
      id: "held",
      header: "Cantidad",
      size: movement ? MOVEMENT_FIGURE : undefined,
      meta: { className: `hidden @2xl:table-cell ${NUMBER_CELL}` },
      cell: ({ row: { original: row } }) => (
        <TruncatedText text={heldAmount(row)} />
      ),
    },
    {
      id: "price",
      header: "Precio",
      size: 128,
      meta: { className: `hidden @3xl:table-cell ${NUMBER_CELL}` },
      cell: ({ row: { original: row } }) => {
        if (!hasUnitPrice(row.holding)) return null;
        const item = valued(row);
        if (!item) return CALCULATING;
        if (item.price !== null) return formatPrice(item.price, unit);
        // A valued holding whose unit is worth less than the decimals show.
        return (
          <MissingFigure
            text={
              item.value === null ? NO_QUOTE : "Precio menor al que se muestra"
            }
          />
        );
      },
    },
    ...(movement ? movementColumns(movement.input) : []),
    {
      id: "value",
      header: "Valor",
      // Narrower than VALUE_CELL on a phone, where two action buttons share
      // the row.
      meta: { className: `w-30 font-medium @2xl:w-40 ${NUMBER_CELL}` },
      cell: ({ row: { original: row } }) => value(row),
    },
    {
      id: "share",
      header: "%",
      size: 72,
      meta: {
        className: `${movement ? "hidden @7xl:table-cell" : "hidden @3xl:table-cell"} text-muted-foreground ${NUMBER_CELL}`,
      },
      cell: ({ row: { original: row } }) => {
        const item = valued(row);
        return (
          <ShareText
            share={item ? item.share : undefined}
            complete={valuation.kinds.total.complete}
          />
        );
      },
    },
  ];

  // A holding's cost, average cost and gain, from its movements: "—" for one
  // with none.
  function movementColumns(input: MovementsInput): ColumnDef<ShownHolding>[] {
    const positionOf = (row: ShownHolding) =>
      row.unsaved ? undefined : (input.positions.get(row.id) ?? null);
    const figure = (
      row: ShownHolding,
      show: (position: Position) => ReactNode,
    ) => {
      const position = positionOf(row);
      if (position === undefined) return CALCULATING;
      if (position === null) return <MissingFigure text="Sin movimientos" />;
      return show(position);
    };
    return [
      {
        id: "average",
        size: MOVEMENT_FIGURE,
        header: "Costo prom.",
        meta: { className: `hidden @5xl:table-cell ${NUMBER_CELL}` },
        cell: ({ row: { original: row } }) =>
          figure(row, (position) => {
            const average = averageCost(position);
            return average === null ? (
              <MissingFigure text="Sin costo" />
            ) : (
              formatPrice(average, unit)
            );
          }),
      },
      {
        id: "cost",
        size: MOVEMENT_FIGURE,
        header: "Costo",
        meta: { className: `hidden @4xl:table-cell ${NUMBER_CELL}` },
        cell: ({ row: { original: row } }) =>
          figure(row, (position) =>
            position.money ? (
              formatAmount(position.money.cost, unit)
            ) : (
              <MissingFigure text="Sin costo en esta moneda" />
            ),
          ),
      },
      {
        id: "gain",
        size: MOVEMENT_FIGURE,
        header: "G/P",
        meta: { className: `hidden @3xl:table-cell ${NUMBER_CELL}` },
        cell: ({ row: { original: row } }) =>
          figure(row, (position) => (
            <GainLossText
              gain={gainLoss(position, valued(row)?.value ?? null)}
              unit={unit}
            />
          )),
      },
    ];
  }

  const tableColumns: ColumnDef<ShownHolding>[] = [
    ...(movement
      ? [
          expandColumn<ShownHolding>({
            label: (row) => `Movimientos de ${named(row)}`,
          }),
        ]
      : []),
    ...columns,
    actionsColumn<ShownHolding>(
      [
        {
          id: "edit",
          icon: Pencil,
          tooltip: "Editar",
          label: (row) => `Editar ${named(row)}`,
          onClick: (row) => openDialog({ kind: "edit", row }),
        },
        ...(archiving
          ? [
              {
                id: "archive",
                icon: Archive,
                tooltip: "Archivar",
                label: (row: ShownHolding) => `Archivar ${named(row)}`,
                onClick: (row: ShownHolding) =>
                  rowAction(
                    { kind: "archive", id: row.id },
                    () => archiving.archive(row.id),
                    row,
                    "archive",
                    "Archivaste",
                  ),
              },
            ]
          : []),
      ],
      { pending },
    ),
  ];

  const shownRows = view.active.filter((row) =>
    matchesFilter(row, filter, names),
  );
  const valueOf = (row: ShownHolding) => valued(row)?.value ?? "0";
  const sortedRows: ShownHolding[] = [...shownRows].sort((a, b) =>
    compareDecimals(valueOf(b), valueOf(a)),
  );
  const { missing } = valuation.kinds.total;
  // The cost and gain of the shown holdings with movements; none while a
  // write runs, which may change them.
  const totals =
    movement && !pending
      ? costTotals(shownRows, movement.input.positions, valuation)
      : undefined;
  const counts: Partial<Record<AssetsTab, number>> = {
    holdings: shownRows.length,
    accounts: new Set(shownRows.map((row) => row.account.id)).size,
    portfolios: new Set(shownRows.map((row) => row.portfolio.id)).size,
    ...(movement && { sales: movement.input.sales.totals.count }),
  };

  const archivedColumns: ColumnDef<ShownHolding>[] | undefined = archiving && [
    {
      id: "name",
      header: "Tenencia",
      cell: ({ row }) => (
        <>
          <TruncatedText text={name(row.original)} />
          <TruncatedText
            className="text-xs text-muted-foreground @2xl:hidden"
            text={`${row.original.account.institution} · ${row.original.portfolio.name}`}
          />
        </>
      ),
    },
    {
      id: "account",
      header: "Cuenta",
      meta: { className: "hidden @2xl:table-cell" },
      cell: ({ row }) => (
        <TruncatedText text={row.original.account.institution} />
      ),
    },
    {
      id: "portfolio",
      header: "Cartera",
      meta: { className: "hidden @2xl:table-cell" },
      cell: ({ row }) => <TruncatedText text={row.original.portfolio.name} />,
    },
    actionsColumn<ShownHolding>(
      [
        {
          id: "restore",
          icon: ArchiveRestore,
          tooltip: "Restaurar",
          label: (row) => `Restaurar ${named(row)}`,
          onClick: (row) =>
            rowAction(
              { kind: "restore", row },
              () => archiving.restore(row.id),
              row,
              "restore",
              "Restauraste",
            ),
        },
      ],
      { pending },
    ),
  ];

  // The sales of the chosen year: those of every holding the filters keep,
  // open or not, so they show even when no open holding matches.
  function salesPanel(input: MovementsInput): ReactNode {
    const year =
      typeof url.params.year === "string" &&
      input.years.includes(url.params.year)
        ? url.params.year
        : input.years[0];
    if (year === undefined) {
      return (
        <p className="text-sm text-muted-foreground">
          Todavía no registraste ventas.
        </p>
      );
    }
    return (
      <>
        <SalesSummary totals={input.sales.totals} unit={unit} year={year} />
        {input.sales.rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {`Ninguna venta de ${year} coincide con los filtros.`}
          </p>
        ) : (
          <SalesTable
            sales={input.sales.rows}
            unit={unit}
            assetName={assetName}
          />
        )}
        {input.sales.truncated && (
          <p className="text-xs text-muted-foreground">
            {`Mostrando las ${SALES_LIMIT} ventas más recientes; los totales las incluyen a todas.`}
          </p>
        )}
      </>
    );
  }

  function panel(): ReactNode {
    switch (tab) {
      case "sales":
        return movement && salesPanel(movement.input);
      case "holdings":
      case "accounts":
      case "portfolios":
        return shownRows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {accounts.length === 0 ? (
              <>
                Para cargar tenencias, primero agregá una cuenta en{" "}
                <Link className="underline" href="/accounts">
                  Cuentas
                </Link>
                .
              </>
            ) : view.active.length > 0 ? (
              view.activeTruncated ? (
                `Ninguna de las ${PAGE_ROW_LIMIT} tenencias más recientes coincide con los filtros.`
              ) : (
                "Ninguna tenencia coincide con los filtros."
              )
            ) : (
              "Todavía no cargaste tenencias."
            )}
          </p>
        ) : tab === "accounts" ? (
          <AccountsBreakdown
            rows={shownRows}
            accounts={valuation.accounts}
            whole={valuation.kinds}
            unit={unit}
            pending={pending}
          />
        ) : tab === "portfolios" ? (
          <PortfoliosBreakdown
            rows={shownRows}
            portfolios={valuation.portfolios}
            total={valuation.kinds.total}
            unit={unit}
            pending={pending}
          />
        ) : (
          <DataTable<ShownHolding>
            columns={tableColumns}
            data={sortedRows}
            caption="Tenencias"
            expandable={(row) =>
              movement !== undefined &&
              !row.unsaved &&
              takesMovements(row.holding)
            }
            renderExpanded={
              movement &&
              ((row) => (
                <div className="grid gap-2">
                  <MovementsTable
                    key={`${row.id}:${movement.input.revisions.get(row.id) ?? 0}:${unit}`}
                    scope={{ holdingId: row.id }}
                    unit={unit}
                    load={movement.input.loadMovements}
                    pending={pending}
                    actions={[
                      {
                        id: "edit",
                        icon: Pencil,
                        tooltip: "Editar",
                        label: (line) =>
                          `Editar ${MOVEMENT_KIND_LABELS[line.movement.kind].toLowerCase()} del ${formatDate(line.movement.date)}`,
                        onClick: (line) =>
                          openMovementDialog({
                            kind: "edit",
                            movement: line.movement,
                          }),
                      },
                    ]}
                  />
                  <div>
                    <PendingButton
                      size="sm"
                      variant="outline"
                      pending={pending}
                      onClick={() =>
                        openMovementDialog({
                          kind: "create",
                          holdingId: row.id,
                        })
                      }
                    >
                      <Plus />
                      Agregar movimiento
                    </PendingButton>
                  </div>
                </div>
              ))
            }
            footer={
              <TableRow>
                {tableColumns.map((column) => (
                  <TableCell key={column.id} className={column.meta?.className}>
                    {column.id === "name" ? (
                      "Total"
                    ) : column.id === "value" ? (
                      <PendingSum
                        sum={valuation.kinds.total}
                        unit={unit}
                        pending={pending}
                      />
                    ) : column.id === "cost" && totals ? (
                      totals.cost === null ? (
                        <MissingFigure text="Sin costo en esta moneda" />
                      ) : (
                        formatAmount(totals.cost, unit)
                      )
                    ) : column.id === "gain" && totals ? (
                      <GainLossText gain={totals.gain} unit={unit} />
                    ) : null}
                  </TableCell>
                ))}
              </TableRow>
            }
          />
        );
      default: {
        const unknown: never = tab;
        return unknown;
      }
    }
  }

  const defaultAccount = accounts.length === 1 ? accounts[0] : undefined;
  const dialogBase = {
    accounts,
    portfolios,
    instruments,
    returnFocusTo: card.focusHeading,
    onClose: () => setDialog(null),
  };

  return (
    <div className="grid gap-6">
      <p role="status" className="sr-only">
        {pending ? "Guardando…" : ""}
      </p>
      <SetupCard
        heading={card.heading}
        pending={pending}
        title="Activos"
        description="Lo que tenés en cada cuenta, valuado con la última cotización"
        addLabel="Agregar tenencia"
        onAdd={() => openDialog({ kind: "create" })}
        secondary={
          movement && (
            <PendingButton
              size="sm"
              variant="outline"
              pending={pending}
              onClick={() =>
                openMovementDialog({ kind: "create", holdingId: null })
              }
            >
              <ArrowLeftRight />
              Agregar movimiento
            </PendingButton>
          )
        }
      >
        <AssetsSummary valuation={valuation} unit={unit} pending={pending} />
        <AssetsTabs
          url={url}
          tabs={tabs}
          idBase={tabsId}
          counts={counts}
          pending={pending}
        />
        <AssetsFilters
          url={url}
          tabs={tabs}
          salesYears={movement?.input.years}
          referenceUnit={referenceUnit}
          filter={filter}
          portfolios={portfolios}
          pending={pending}
        />
        <div
          role="tabpanel"
          id={panelId(tabsId)}
          aria-labelledby={tabId(tabsId, tab)}
          className="grid gap-4"
        >
          {panel()}
          {tab !== "sales" && missing > 0 && (
            <p className="text-xs text-muted-foreground">
              {/* The total is marked only when it values some holdings. */}
              {missing < valuation.kinds.total.count && "* "}
              {missing === 1
                ? "A una tenencia le falta cotización; el total no la incluye."
                : `A ${missing} tenencias les falta cotización; el total no las incluye.`}
            </p>
          )}
          {tab !== "sales" && view.activeTruncated && shownRows.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {missing < valuation.kinds.total.count && "* "}
              {`Mostrando las ${PAGE_ROW_LIMIT} más recientes; el total no incluye las demás.`}
            </p>
          )}
        </div>
        {archivedColumns && (
          <ArchivedList
            view={view}
            title="Tenencias"
            label="Archivadas"
            emptyText="No hay más tenencias archivadas."
            firstPageLabel="Ver las más recientes"
            pending={pending}
            columns={archivedColumns}
          />
        )}
      </SetupCard>
      {dialog?.kind === "create" && (
        <HoldingDialog
          mode="create"
          {...dialogBase}
          initial={
            dialog.initial ??
            initialFields(null, {
              accountId: defaultAccount?.id ?? "",
              portfolioId:
                filter.portfolioId ??
                defaultAccount?.portfolio.id ??
                portfolios.at(-1)?.id ??
                "",
              today,
            })
          }
          portfolioChosen={
            filter.portfolioId !== null || dialog.initial !== undefined
          }
          initialError={dialog.initialError}
          onSubmit={(fields, chosen: ChosenHolding) => {
            const row = holdingRow(temporaryId(), fields, chosen);
            return submit(
              dialog,
              fields,
              { kind: "create", row },
              () => actions.create(toInsert(fields)),
              "Agregaste",
              row,
            );
          }}
        />
      )}
      {dialog?.kind === "edit" && (
        <HoldingDialog
          key={dialog.row.id}
          mode="edit"
          row={dialog.row}
          {...dialogBase}
          amountFromMovements={
            movement?.input.positions.has(dialog.row.id) ?? false
          }
          initial={
            dialog.initial ??
            initialFields(dialog.row, { accountId: "", portfolioId: "", today })
          }
          initialError={dialog.initialError}
          onSubmit={(fields, chosen) => {
            const row = holdingRow(dialog.row.id, fields, chosen);
            return submit(
              dialog,
              fields,
              { kind: "update", row },
              () =>
                actions.update(
                  dialog.row.id,
                  toUpdate(fields, dialog.row.portfolio.id),
                ),
              "Guardaste",
              row,
            );
          }}
        />
      )}
      {movement && movementDialog && (
        <MovementDialog
          mode={movementDialog.kind}
          holdings={
            movementDialog.kind === "edit"
              ? movementHoldings.filter(
                  (each) => each.id === movementDialog.movement.holding_id,
                )
              : movementDialog.holdingId === null
                ? movementHoldings
                : movementHoldings.filter(
                    (each) => each.id === movementDialog.holdingId,
                  )
          }
          initial={
            movementDialog.initial ??
            (movementDialog.kind === "edit"
              ? initialMovementFields(movementDialog.movement, {
                  kind: movementDialog.movement.kind,
                  holdingId: movementDialog.movement.holding_id,
                  currency: movementDialog.movement.currency,
                  date: movementDialog.movement.date,
                })
              : newMovementFields(movementDialog.holdingId))
          }
          initialError={movementDialog.initialError}
          today={today}
          returnFocusTo={card.focusHeading}
          onClose={() => setMovementDialog(null)}
          onSubmit={(fields) =>
            submitMovement(movementDialog, movement.actions, fields)
          }
        />
      )}
    </div>
  );
}
