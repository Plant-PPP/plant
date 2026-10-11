"use client";

import {
  type Denominator,
  type MovementKind,
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
  SlidersHorizontal,
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
import { classOf, HOLDING_CLASS_LABELS } from "@/lib/holdings/classes";
import {
  type PriceFields,
  type PriceResult,
  priceFields,
  toPriceInput,
} from "@/lib/holdings/price-input";
import { holdingName, instrumentNames } from "@/lib/holdings/holding-name";
import {
  MOVEMENT_KIND_LABELS,
  MOVEMENT_MESSAGES,
  PRICE_MESSAGES,
} from "@/lib/holdings/messages";
import { averageCost, costTotals, gainLoss } from "@/lib/holdings/cost-totals";
import type {
  MovementResult,
  MovementsInput,
  OperationParts,
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
import { PriceDialog } from "./price-dialog";
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
  type MovementFields,
  newMovementFields,
  operationFields,
  toOperationInput,
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

// A new operation, from the header or for one holding (`kind` preset for an
// adjustment), or an edit of one.
type MovementDialogState =
  | ({
      kind: "create";
      row: HoldingRow | null;
      preset?: MovementKind;
    } & Retry<MovementFields>)
  | ({ kind: "edit"; operation: OperationParts } & Retry<MovementFields>);

type PriceDialogState = { symbol: string } & Retry<PriceFields>;

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

export type PriceActions = {
  set: (input: unknown) => Promise<PriceResult>;
};

// The manual price the valuation took for each symbol, per unit in the
// instrument's currency, with its date; a page without them offers no
// "Cargar precio".
export type ManualPrices = {
  manual: ReadonlyMap<string, { price: string; date: string }>;
  // Whether the feeds price a symbol, which then takes no manual price.
  fed: (symbol: string) => boolean;
  actions: PriceActions;
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
  prices,
  instrumentHref,
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
  prices?: ManualPrices;
  // An instrument's history page; a page without one names it plainly.
  instrumentHref?: (symbol: string) => string;
} & MovementProps) {
  const {
    shown: view,
    pending,
    run,
  } = useOptimisticWrites(
    holdings,
    // An operation may touch no holding the list shows yet.
    (state, change: ListChange<HoldingRow> | null) =>
      change ? applyChange(state, change) : state,
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
  const [priceDialog, setPriceDialog] = useState<PriceDialogState | null>(null);
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

  function openMovementDialog(next: MovementDialogState) {
    if (pending) return;
    if (next.kind === "create" && accounts.length === 0) {
      toast.error("Primero agregá una cuenta en Cuentas.");
      return;
    }
    setMovementDialog(next);
  }

  // A new operation's fields: today, in the holding's account, instrument and
  // portfolio when opened from one (its amount as an opening balance), else
  // the first account's and its portfolio.
  function newOperationFields(
    row: HoldingRow | null,
    preset: MovementKind | undefined,
  ): MovementFields {
    const symbol =
      row?.holding.asset_class === "instrument"
        ? row.holding.instrument_symbol
        : (instruments[0]?.symbol ?? "");
    const account = row?.account ?? accounts[0];
    const hasMovements = row
      ? (movement?.input.positions.has(row.id) ?? false)
      : true;
    const kind = preset ?? (hasMovements ? "purchase" : "opening_balance");
    return newMovementFields({
      kind,
      accountId: account?.id ?? "",
      instrument: symbol,
      currency:
        instruments.find((each) => each.symbol === symbol)?.currency ?? "ARS",
      date: today,
      portfolioId:
        row?.portfolio.id ??
        accounts[0]?.portfolio.id ??
        portfolios[0]?.id ??
        "",
      ...(kind === "opening_balance" && row && { size: row.holding.amount }),
    });
  }

  function submitMovement(
    state: MovementDialogState,
    actions: MovementActions,
    fields: MovementFields,
  ): boolean {
    const input = toOperationInput(fields);
    const instrument =
      instruments.find((each) => each.symbol === fields.instrument)?.name ??
      fields.instrument;
    // The holdings it touches show as saving until they are read again.
    const shown = view.active.find(
      (row) =>
        row.account.id === fields.accountId &&
        row.holding.asset_class === "instrument" &&
        row.holding.instrument_symbol === fields.instrument &&
        fields.parts.some((part) => part.portfolioId === row.portfolio.id),
    );
    return card.dialogAction(
      shown ? { kind: "update", row: shown } : null,
      () =>
        state.kind === "edit"
          ? actions.update(
              state.operation.parts[0]!.movement.operation_id,
              input,
            )
          : actions.create(input),
      MOVEMENT_MESSAGES,
      {
        done:
          state.kind === "edit"
            ? `Guardaste el movimiento de ${instrument}`
            : `Agregaste un movimiento de ${instrument}`,
        reopen: (error) =>
          setMovementDialog({
            ...state,
            initial: fields,
            initialError: error,
          }),
      },
    );
  }

  // The account and instrument a holding's dialog keeps, by name.
  const fixedOf = (accountId: string, symbol: string) => ({
    account:
      accounts.find((each) => each.id === accountId)?.institution ??
      view.active.find((row) => row.account.id === accountId)?.account
        .institution ??
      "",
    instrument:
      instruments.find((each) => each.symbol === symbol)?.name ?? symbol,
  });

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
        const href =
          instrumentHref && shown.holding.asset_class === "instrument"
            ? instrumentHref(shown.holding.instrument_symbol)
            : null;
        return (
          <>
            {href ? (
              <Link
                href={href}
                className="block truncate font-medium underline-offset-2 hover:underline"
                title={assetName(shown)}
              >
                {assetName(shown)}
              </Link>
            ) : (
              <TruncatedText text={assetName(shown)} />
            )}
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
        <TruncatedText text={HOLDING_CLASS_LABELS[classOf(row)]} />
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
        const symbol =
          row.holding.asset_class === "instrument"
            ? row.holding.instrument_symbol
            : null;
        const manualDate = symbol && prices?.manual.get(symbol)?.date;
        const opensPrice =
          prices && symbol !== null && !prices.fed(symbol)
            ? () => setPriceDialog({ symbol })
            : null;
        const figure =
          item.price !== null ? (
            formatPrice(item.price, unit)
          ) : (
            // A valued holding whose unit is worth less than the decimals
            // show.
            <MissingFigure
              text={
                item.value === null
                  ? NO_QUOTE
                  : "Precio menor al que se muestra"
              }
            />
          );
        if (!opensPrice) return figure;
        return (
          <span className="grid justify-items-end">
            {figure}
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground text-xs underline-offset-2 hover:underline"
              aria-label={
                manualDate
                  ? `Precio manual del ${formatDate(manualDate)} de ${symbol}. Cargar otro`
                  : `Cargar precio de ${symbol}`
              }
              onClick={opensPrice}
            >
              {manualDate
                ? `Manual · ${formatDate(manualDate)}`
                : "Cargar precio"}
            </button>
          </span>
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

  // With movements, an instrument holding changes through them: it takes an
  // adjustment instead of an edit.
  const adjusts = (row: HoldingRow) =>
    movement !== undefined && takesMovements(row.holding);

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
          label: (row) =>
            `${adjusts(row) ? "Ajustar" : "Editar"} ${named(row)}`,
          variant: (row) =>
            adjusts(row)
              ? { icon: SlidersHorizontal, tooltip: "Ajustar" }
              : undefined,
          onClick: (row) =>
            adjusts(row)
              ? openMovementDialog({
                  kind: "create",
                  row,
                  preset: "adjustment",
                })
              : openDialog({ kind: "edit", row }),
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
                            operation: line.operation,
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
                        openMovementDialog({ kind: "create", row })
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
              onClick={() => openMovementDialog({ kind: "create", row: null })}
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
          classes={new Set(holdings.active.map(classOf))}
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
          accounts={accounts}
          portfolios={portfolios}
          instruments={instruments}
          fixed={
            movementDialog.kind === "edit"
              ? fixedOf(
                  movementDialog.operation.accountId,
                  movementDialog.operation.instrument,
                )
              : movementDialog.row?.holding.asset_class === "instrument"
                ? fixedOf(
                    movementDialog.row.account.id,
                    movementDialog.row.holding.instrument_symbol,
                  )
                : undefined
          }
          initial={
            movementDialog.initial ??
            (movementDialog.kind === "edit"
              ? operationFields(movementDialog.operation.parts, {
                  accountId: movementDialog.operation.accountId,
                  instrument: movementDialog.operation.instrument,
                })
              : newOperationFields(movementDialog.row, movementDialog.preset))
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
      {priceDialog && prices && (
        <PriceDialogFor
          state={priceDialog}
          instruments={instruments}
          prices={prices}
          today={today}
          returnFocusTo={card.focusHeading}
          onClose={() => setPriceDialog(null)}
          onSubmit={(fields, instrument) =>
            card.dialogAction(
              null,
              () => prices.actions.set(toPriceInput(fields, instrument)),
              PRICE_MESSAGES,
              {
                done: `Cargaste el precio de ${instrument.symbol}`,
                reopen: (error) =>
                  setPriceDialog({
                    ...priceDialog,
                    initial: fields,
                    initialError: error,
                  }),
              },
            )
          }
        />
      )}
    </div>
  );
}

// The price dialog for a symbol, prefilled with its latest manual price.
function PriceDialogFor({
  state,
  instruments,
  prices,
  today,
  returnFocusTo,
  onClose,
  onSubmit,
}: {
  state: PriceDialogState;
  instruments: InstrumentRow[];
  prices: ManualPrices;
  today: string;
  returnFocusTo: () => HTMLElement | null;
  onClose: () => void;
  onSubmit: (fields: PriceFields, instrument: InstrumentRow) => boolean;
}) {
  const instrument = instruments.find((each) => each.symbol === state.symbol);
  if (!instrument) return null;
  return (
    <PriceDialog
      instrument={instrument}
      initial={
        state.initial ??
        priceFields(
          instrument.type,
          prices.manual.get(state.symbol) ?? null,
          today,
        )
      }
      initialError={state.initialError}
      today={today}
      returnFocusTo={returnFocusTo}
      onClose={onClose}
      onSubmit={(fields) => onSubmit(fields, instrument)}
    />
  );
}
