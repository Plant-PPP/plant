"use client";

import type { Denominator } from "@plant/core";
import { compareDecimals } from "@plant/shared";
import type { ColumnDef } from "@tanstack/react-table";
import { Archive, ArchiveRestore, Pencil } from "lucide-react";
import { useId, useState } from "react";
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
} from "@/components/ui/data-table";
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
import { ASSET_CLASS_LABELS } from "@/lib/holdings/messages";
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
import { PAGE_ROW_LIMIT } from "@/lib/portfolio-setup/limits";
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
import { useAssetsUrl } from "./assets-url";
import { PortfoliosBreakdown } from "./portfolios-breakdown";
import {
  CALCULATING,
  MissingFigure,
  NO_QUOTE,
  NUMBER_CELL,
  PendingSum,
  ShareText,
} from "./sum-text";

const MESSAGES = WRITE_MESSAGES.holdings;

type ShownHolding = HoldingRow & { unsaved?: true };

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
  const tabsId = useId();
  const router = useRouter();
  const [dialog, setDialog] = useState<DialogState | null>(null);
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
      meta: { className: "hidden @3xl:table-cell" },
      cell: ({ row: { original: row } }) => {
        const ticker = tickerOf(row);
        return ticker === null ? null : (
          <span className="bg-muted inline-block max-w-full truncate rounded px-1.5 py-0.5 font-mono text-xs">
            {ticker}
          </span>
        );
      },
    },
    {
      id: "class",
      header: "Tipo",
      size: 104,
      meta: { className: "hidden @4xl:table-cell text-muted-foreground" },
      cell: ({ row: { original: row } }) => (
        <TruncatedText text={ASSET_CLASS_LABELS[row.holding.asset_class]} />
      ),
    },
    {
      id: "account",
      header: "Cuenta",
      size: 144,
      meta: { className: "hidden @2xl:table-cell text-muted-foreground" },
      cell: ({ row: { original: row } }) => (
        <span className="flex min-w-0 items-center gap-2">
          <InstitutionIcon name={row.account.institution} />
          <TruncatedText text={row.account.institution} />
        </span>
      ),
    },
    {
      id: "portfolio",
      header: "Cartera",
      size: 120,
      meta: { className: "hidden @4xl:table-cell text-muted-foreground" },
      cell: ({ row: { original: row } }) => (
        <TruncatedText text={row.portfolio.name} />
      ),
    },
    {
      id: "held",
      header: "Cantidad",
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
        className: `hidden @3xl:table-cell text-muted-foreground ${NUMBER_CELL}`,
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

  const tableColumns: ColumnDef<ShownHolding>[] = [
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
  const sortedRows = [...shownRows].sort((a, b) =>
    compareDecimals(valueOf(b), valueOf(a)),
  );
  const { missing } = valuation.kinds.total;
  const counts: Partial<Record<AssetsTab, number>> = {
    holdings: shownRows.length,
    accounts: new Set(shownRows.map((row) => row.account.id)).size,
    portfolios: new Set(shownRows.map((row) => row.portfolio.id)).size,
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
          {shownRows.length === 0 ? (
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
            <DataTable
              columns={tableColumns}
              data={sortedRows}
              caption="Tenencias"
              footer={
                <TableRow>
                  {tableColumns.map((column) => (
                    <TableCell
                      key={column.id}
                      className={column.meta?.className}
                    >
                      {column.id === "name" ? (
                        "Total"
                      ) : column.id === "value" ? (
                        <PendingSum
                          sum={valuation.kinds.total}
                          unit={unit}
                          pending={pending}
                        />
                      ) : null}
                    </TableCell>
                  ))}
                </TableRow>
              }
            />
          )}
          {missing > 0 && (
            <p className="text-xs text-muted-foreground">
              {/* The total is marked only when it values some holdings. */}
              {missing < valuation.kinds.total.count && "* "}
              {missing === 1
                ? "A una tenencia le falta cotización; el total no la incluye."
                : `A ${missing} tenencias les falta cotización; el total no las incluye.`}
            </p>
          )}
          {view.activeTruncated && shownRows.length > 0 && (
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
    </div>
  );
}
