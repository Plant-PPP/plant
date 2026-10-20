"use client";

import type {
  Denominator,
  QuoteSnapshot,
  RealEstateFigures,
  ReferenceDollar,
} from "@plant/core";
import { compareDecimals } from "@plant/shared";
import type { ColumnDef } from "@tanstack/react-table";
import {
  Archive,
  ArchiveRestore,
  ArrowLeftRight,
  House,
  Pencil,
  RefreshCw,
  Wallet,
} from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import Link from "next/link";

import { EmptyState } from "@/components/ui/empty-state";
import { PageButton } from "@/components/ui/page-button";
import {
  dialogAnswer,
  type LinksFor,
  type MessagesFor,
} from "@/components/portfolio-setup/answers";
import {
  applyChange,
  type ListChange,
  temporaryId,
} from "@/components/portfolio-setup/list-change";
import {
  type Result,
  useOptimisticWrites,
} from "@/components/portfolio-setup/optimistic-writes";
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
import { formatAmount, formatQuantity } from "@/lib/format/amount";
import { formatDate } from "@/lib/format/date";
import {
  type AssetsFilter,
  type AssetsTab,
  type SALES_TABS,
  type TABS,
  parseAssetsParams,
  tabOf,
  matchesFilter,
  tickerOf,
} from "@/lib/holdings/assets-filter";
import { classOf, HOLDING_CLASS_LABELS } from "@/lib/holdings/classes";
import {
  formatQuotedPrice,
  type PriceFields,
  priceFields,
  toPriceInput,
} from "@/lib/holdings/price-input";
import {
  currencyOf,
  holdingInSentence,
  holdingName,
  type HoldingOrigin,
  holdingPlace,
  instrumentNames,
} from "@/lib/holdings/holding-name";
import {
  PLACEMENT_KIND_LABELS,
  type PlacementKind,
} from "@/lib/holdings/placement";
import type { RealEstateSheet } from "@/lib/real-estate/sheet";
import { PRICE_MESSAGES } from "@/lib/holdings/messages";
import {
  averageOf,
  costTotals,
  overExactSum,
} from "@/lib/holdings/cost-totals";
import {
  type AssetKey,
  assetKey,
  type AssetsRow,
  byHolding,
  byInstrument,
  holdingsOf,
  type RowFigures,
  rowFigures,
} from "@/lib/holdings/assets-rows";
import type { MovementsInput } from "@/lib/holdings/movements-input";
import { type ScopeHrefs, scopeLink } from "@/lib/holdings/scope-hrefs";
import type {
  HoldingRow,
  HoldingsView,
  InstrumentRow,
} from "@/lib/holdings/read";
import {
  type HoldingsValuation,
  hasUnitPrice,
  holdingsValuation,
} from "@/lib/holdings/valuation-view";
import { PAGE_ROW_LIMIT, SALES_LIMIT } from "@/lib/portfolio-setup/limits";
import { HOLDING_LINKS, WRITE_MESSAGES } from "@/lib/portfolio-setup/messages";
import type {
  PortfolioRow,
  SourceConnectionRow,
} from "@/lib/portfolio-setup/read";
import type { WriteResult } from "@/lib/portfolio-setup/write-result";
import type {
  HoldingActions,
  MovementActions,
  PriceActions,
} from "@/lib/holdings/write-actions";
import type { KeysetParams } from "@/lib/supabase/keyset";

import { InstitutionIcon } from "@/components/portfolio-setup/institution-field";

import { AccountsBreakdown } from "./accounts-breakdown";
import { AssetsFilters } from "./assets-filters";
import { AssetsSummary } from "./assets-summary";
import { RealEstateDialog } from "./real-estate-dialog";
import { type SheetFields, sheetFields } from "./real-estate-fields";
import { RenewDialog } from "./renew-dialog";
import { type ChosenHolding, HoldingDialog } from "./holding-dialog";
import { PriceDialog } from "./price-dialog";
import { useConfirm } from "@/components/ui/confirm-dialog";
import {
  type HoldingFields,
  holdingRow,
  initialFields,
  toInsert,
  toUpdate,
} from "./holding-fields";
import { AssetsTabs, panelId, tabId } from "./assets-tabs";
import {
  AccountsCell,
  NameLink,
  PortfoliosCell,
  TickerChip,
} from "./holding-cells";
import { answeredInPlace, useAssetsUrl } from "./assets-url";
import { PortfoliosBreakdown } from "./portfolios-breakdown";
import { instrumentPreset, useMovementDialogs } from "./movement-dialogs";
import { SalesSummary } from "./sales-summary";
import { SalesTable } from "./sales-table";
import {
  CALCULATING,
  GainLossText,
  MissingFigure,
  missingQuotesText,
  NO_QUOTE,
  NUMBER_CELL,
  PendingSum,
  ShareText,
} from "./sum-text";

const MESSAGES = WRITE_MESSAGES.holdings;

// The width of each figure the movements add, and of the quantity beside them.
const MOVEMENT_FIGURE = 112;

type ShownHolding = HoldingRow & { unsaved?: true };

// A Tenencias row, unsaved while a write to any of its holdings runs.
type TenenciaRow = AssetsRow<ShownHolding> & { unsaved?: true };

type PriceDialogState = { symbol: string } & Retry<PriceFields>;

type DialogState =
  // `attempt` counts the refusals found before any write, each shown on a
  // fresh dialog.
  | ({ kind: "create"; attempt?: number } & Retry<HoldingFields>)
  | ({ kind: "edit"; row: HoldingRow } & Retry<HoldingFields>);

// What a holding is: its quantity or amount, in its own unit.
function heldAmount({ holding }: HoldingRow): string {
  return holding.asset_class === "instrument"
    ? `${formatQuantity(holding.amount)} ${holding.instrument_symbol}`
    : formatAmount(holding.amount, holding.currency);
}

// The manual price the valuation took for each symbol, per unit in the
// instrument's currency, with its date; a page without them offers no
// "Cargar precio".
export type ManualPrices = {
  manual: ReadonlyMap<string, { price: string; date: string }>;
  // Whether the feeds price a symbol, which then takes no manual price.
  fed: ReadonlySet<string>;
  actions: PriceActions;
};

// Where each holding came from and which assets count in the report, keyed by
// `assetKey`. A page with them shows each holding's origin and lets the user
// leave an asset out; its edit then writes the holding and the choice
// together, both or neither.
export type HoldingDetails = {
  originOf: (holdingId: string) => HoldingOrigin | undefined;
  inTaxReport: (assetKey: AssetKey) => boolean;
  // What a placement at a rate is, and the placement a renewal renewed.
  placementOf: (holdingId: string) => PlacementKind;
  renewalOf: (holdingId: string) => HoldingRow | undefined;
  actions: {
    setInTaxReport: (assetKey: AssetKey, on: boolean) => Promise<WriteResult>;
    update: (
      id: string,
      input: unknown,
      choices: { inTaxReport: boolean; placement?: PlacementKind },
    ) => Promise<WriteResult>;
    setPlacement: (id: string, kind: PlacementKind) => Promise<WriteResult>;
    renew: (id: string, input: unknown) => Promise<WriteResult>;
  };
};

// Each property's sheet, on a page that keeps them: the sheet as saved, the
// debts a mortgage or installments can be, its figures in a unit, and its
// write.
export type RealEstateSheets = {
  sheetOf: (holdingId: string) => RealEstateSheet | undefined;
  liabilities: readonly { id: string; label: string }[];
  figures: (
    holding: HoldingRow,
    sheet: RealEstateSheet,
    unit: Denominator,
  ) => RealEstateFigures;
  save: (holdingId: string, sheet: RealEstateSheet) => Promise<WriteResult>;
};

// An edit's write: with `details`, the holding, its asset's report choice and
// a placement's kind together; otherwise the holding alone, whose parsed
// update takes neither.
export const saveHoldingEdit = (
  { actions, details }: { actions: HoldingActions; details?: HoldingDetails },
  row: HoldingRow,
  fields: HoldingFields,
): Promise<WriteResult> => {
  const input = toUpdate(fields, row.portfolio.id);
  return details
    ? details.actions.update(row.id, input, {
        inTaxReport:
          fields.inTaxReport ?? details.inTaxReport(assetKey(row.holding)),
        ...(fields.placement && { placement: fields.placement }),
      })
    : actions.update(row.id, input);
};

// A page offers the sales tab exactly when it passes movements. Where it
// keeps movements, Tenencias shows an instrument as one row across its
// holdings and links it to the instrument's page, which holds each holding's
// actions; until production has that page (PLA-103), it shows each holding.
type MovementProps =
  | {
      tabs: typeof TABS & { sales?: never };
      movements?: undefined;
      movementActions?: undefined;
      // The pages an instrument, account or portfolio opens; a page without
      // them names each plainly.
      hrefs?: ScopeHrefs;
    }
  | {
      tabs: typeof SALES_TABS;
      movements: MovementsInput;
      movementActions: MovementActions;
      hrefs: ScopeHrefs;
    };

export function AssetsSetup({
  holdings,
  valuation: rendered,
  unit,
  referenceUnit,
  filter: renderedFilter,
  live,
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
  details,
  realEstate,
  hrefs,
}: {
  holdings: HoldingsView;
  valuation: HoldingsValuation;
  unit: Denominator;
  referenceUnit: Denominator;
  filter: AssetsFilter;
  // Today's quotes the valuation took, for a page that filters and values its
  // holdings itself as the filters change, without asking the server.
  live?: {
    snapshot: QuoteSnapshot;
    referenceDollar: ReferenceDollar;
    truncated: boolean;
  };
  params: KeysetParams;
  accounts: SourceConnectionRow[];
  portfolios: PortfolioRow[];
  instruments: InstrumentRow[];
  today: string;
  actions: HoldingActions;
  prices?: ManualPrices;
  details?: HoldingDetails;
  realEstate?: RealEstateSheets;
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
  const url = useAssetsUrl(
    params,
    live && ((next) => answeredInPlace(params, next, tabs)),
  );
  // The tab shows at once; its data is already on the page.
  const tab = tabOf(url.params.tab, tabs);
  const filter = live
    ? parseAssetsParams(url.params, {
        portfolioIds: portfolios.map(({ id }) => id),
        tabs,
        salesYears: [],
      }).filter
    : renderedFilter;
  const { archiving, delete: deleteHolding } = actions;
  // The movement columns, rows and tab, for a page that passes movements.
  const movement = movements &&
    movementActions && { input: movements, actions: movementActions };
  const tabsId = useId();
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [priceDialog, setPriceDialog] = useState<PriceDialogState | null>(null);
  const [sheet, setSheet] = useState<{
    row: HoldingRow;
    initial?: SheetFields;
    initialError?: string;
  } | null>(null);
  const [renewing, setRenewing] = useState<{
    row: HoldingRow;
    initialError?: string;
  } | null>(null);
  const names = instrumentNames(instruments);
  const valuation = live
    ? holdingsValuation({
        holdings: holdings.active.filter((row) =>
          matchesFilter(row, filter, names),
        ),
        truncated: live.truncated,
        snapshot: live.snapshot,
        unit,
        referenceDollar: live.referenceDollar,
      })
    : rendered;
  // A placement at a rate with no name goes by its kind, where the page
  // knows it.
  const kindLabel = (row: HoldingRow) =>
    details && row.holding.asset_class === "fixed_term"
      ? PLACEMENT_KIND_LABELS[details.placementOf(row.id)]
      : undefined;
  const name = (row: HoldingRow) =>
    holdingName(row.holding, names, kindLabel(row));
  // What the table calls an asset: an instrument by its name, beside its
  // ticker.
  const assetName = (row: HoldingRow) =>
    row.holding.asset_class === "instrument"
      ? (names.get(row.holding.instrument_symbol) ??
        row.holding.instrument_symbol)
      : holdingName(row.holding, names, kindLabel(row));
  // A placement that reached its maturity, on a page that can renew it.
  const renewable = (row: HoldingRow) =>
    details !== undefined &&
    row.holding.asset_class === "fixed_term" &&
    row.holding.matures_on <= today;
  const named = (row: HoldingRow) => holdingInSentence(row, names);
  const { confirm, dialog: confirmDialog } = useConfirm(card.focusHeading);
  const dialogs = useMovementDialogs({
    card,
    active: view.active,
    accounts,
    portfolios,
    instruments,
    today,
    names,
    confirm,
    pending,
  });

  function openDialog(next: DialogState) {
    if (pending) return;
    if (next.kind === "create" && accounts.length === 0) {
      dialogs.noAccount();
      return;
    }
    setDialog(next);
  }

  function rowAction<R extends Result>(
    change: ListChange<HoldingRow>,
    call: () => Promise<R>,
    messages: MessagesFor<R>,
    row: HoldingRow,
    actionId: "archive" | "restore" | "delete",
    done: string,
    links?: LinksFor<R>,
  ) {
    card.rowAction(
      change,
      call,
      (result) => dialogAnswer(result, messages, links),
      {
        done: `${done} ${named(row)}`,
        rowId: row.id,
        actionId,
      },
    );
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
      links: HOLDING_LINKS,
      reopen: (error) =>
        setDialog({ ...dialog, initial: fields, initialError: error }),
    });
  }

  // A row a write has not saved yet carries `unsaved` (list-change.ts).
  const shownRows: ShownHolding[] = view.active.filter((row) =>
    matchesFilter(row, filter, names),
  );
  // Where movements are kept, an instrument is one row across its holdings,
  // which its own page lists.
  const rows: TenenciaRow[] = (
    movement ? byInstrument(shownRows) : byHolding(shownRows)
  ).map((row) =>
    holdingsOf(row).some((each) => each.unsaved)
      ? { ...row, unsaved: true as const }
      : row,
  );
  const figures = new Map(
    rows.map((row) => [
      row.id,
      rowFigures(row, { valuation, positions: movement?.input.positions }),
    ]),
  );
  const factsOf = (row: TenenciaRow) => figures.get(row.id)!;
  // What the server valued for a row; nothing yet for one it has not saved.
  const valued = (row: TenenciaRow) => (row.unsaved ? undefined : factsOf(row));
  const firstOf = (row: TenenciaRow) => holdingsOf(row)[0];
  const symbolOf = (row: TenenciaRow) => {
    const { holding } = firstOf(row);
    return holding.asset_class === "instrument"
      ? holding.instrument_symbol
      : null;
  };

  // A value carries the date of the oldest quote or valuation it used.
  const value = (row: TenenciaRow) => {
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

  // What a row holds: an instrument's units across its holdings, or the
  // holding's amount in its own unit.
  const held = (row: TenenciaRow) =>
    row.kind === "instrument"
      ? `${formatQuantity(factsOf(row).quantity)} ${row.symbol}`
      : heldAmount(row.row);

  const columns: ColumnDef<TenenciaRow>[] = [
    {
      id: "name",
      header: "Activo",
      cell: ({ row: { original: row } }) => {
        const first = firstOf(row);
        const ticker = tickerOf(first);
        const symbol = symbolOf(row);
        const { accounts: where } = factsOf(row);
        return (
          <>
            <NameLink
              text={assetName(first)}
              href={
                symbol !== null
                  ? (scopeLink(hrefs, "instrument")?.(symbol) ?? null)
                  : null
              }
            />
            <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground @2xl:hidden">
              <TruncatedText
                className="max-w-[60%] shrink-0"
                text={held(row)}
              />
              <span aria-hidden className="shrink-0">
                ·
              </span>
              {where.length === 1 ? (
                <>
                  <InstitutionIcon name={where[0]!.institution} />
                  <TruncatedText text={where[0]!.institution} />
                </>
              ) : (
                <AccountsCell accounts={where} />
              )}
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
        const ticker = tickerOf(firstOf(row));
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
        <TruncatedText text={HOLDING_CLASS_LABELS[classOf(firstOf(row))]} />
      ),
    },
    {
      id: "account",
      header: "Cuenta",
      size: movement ? 128 : 144,
      meta: { className: "hidden @2xl:table-cell text-muted-foreground" },
      cell: ({ row: { original: row } }) => (
        <AccountsCell accounts={factsOf(row).accounts} />
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
        <PortfoliosCell portfolios={factsOf(row).portfolios} />
      ),
    },
    {
      id: "held",
      header: "Cantidad",
      size: movement ? MOVEMENT_FIGURE : undefined,
      meta: { className: `hidden @2xl:table-cell ${NUMBER_CELL}` },
      cell: ({ row: { original: row } }) => <TruncatedText text={held(row)} />,
    },
    {
      id: "price",
      header: "Precio",
      size: 128,
      meta: { className: `hidden @3xl:table-cell ${NUMBER_CELL}` },
      cell: ({ row: { original: row } }) => {
        const first = firstOf(row);
        if (!hasUnitPrice(first.holding)) return null;
        const item = valued(row);
        if (!item) return CALCULATING;
        const symbol = symbolOf(row);
        const manualDate = symbol && prices?.manual.get(symbol)?.date;
        const opensPrice =
          prices && symbol !== null ? () => setPriceDialog({ symbol }) : null;
        const fed = symbol !== null && prices?.fed.has(symbol);
        const figure =
          item.price !== null ? (
            formatQuotedPrice(item.price, unit, first.instrumentType)
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
              className="text-muted-foreground hover:text-foreground text-xs"
              aria-label={
                manualDate
                  ? `Precio corregido a mano el ${formatDate(manualDate)} de ${symbol}. Cambiarlo`
                  : fed
                    ? `Corregir el precio de ${symbol}`
                    : `Cargar precio de ${symbol}`
              }
              onClick={opensPrice}
            >
              {manualDate
                ? `Manual · ${formatDate(manualDate)}`
                : fed
                  ? "Corregir"
                  : "Cargar precio"}
            </button>
          </span>
        );
      },
    },
    ...(movement ? movementColumns() : []),
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

  // A row's cost, average cost and gain, from its holdings' movements: "—"
  // for one with none.
  function movementColumns(): ColumnDef<TenenciaRow>[] {
    const figure = (
      row: TenenciaRow,
      show: (cost: NonNullable<RowFigures["cost"]>) => ReactNode,
    ) => {
      if (row.unsaved) return CALCULATING;
      const { cost } = factsOf(row);
      if (!cost || cost.count === 0) {
        return <MissingFigure text="Sin movimientos" />;
      }
      return show(cost);
    };
    return [
      {
        id: "average",
        size: MOVEMENT_FIGURE,
        header: "Costo prom.",
        meta: { className: `hidden @5xl:table-cell ${NUMBER_CELL}` },
        cell: ({ row: { original: row } }) =>
          figure(row, ({ cost, quantity }) => {
            const average =
              cost === null || quantity === null
                ? null
                : averageOf(cost, quantity);
            return average === null ? (
              <MissingFigure text="Sin costo" />
            ) : (
              formatQuotedPrice(average, unit, firstOf(row).instrumentType)
            );
          }),
      },
      {
        id: "cost",
        size: MOVEMENT_FIGURE,
        header: "Costo",
        meta: { className: `hidden @4xl:table-cell ${NUMBER_CELL}` },
        cell: ({ row: { original: row } }) =>
          figure(row, ({ cost }) =>
            cost !== null ? (
              formatAmount(cost, unit)
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
          figure(row, ({ gain }) => <GainLossText gain={gain} unit={unit} />),
      },
    ];
  }

  function addAssetMovement(row: TenenciaRow & { kind: "instrument" }) {
    dialogs.openMovementDialog({
      kind: "create",
      row: null,
      initial: dialogs.newOperationFields(
        null,
        instrumentPreset(row.symbol, holdingsOf(row)),
      ),
    });
  }

  const isInstrument = (row: TenenciaRow) => row.kind === "instrument";

  const tableColumns: ColumnDef<TenenciaRow>[] = [
    ...columns,
    actionsColumn<TenenciaRow>(
      [
        {
          id: "edit",
          icon: Pencil,
          tooltip: "Editar",
          label: (row) =>
            isInstrument(row)
              ? `Agregar movimiento de ${name(firstOf(row))}`
              : `Editar ${named(firstOf(row))}`,
          variant: (row) =>
            isInstrument(row)
              ? { icon: ArrowLeftRight, tooltip: "Agregar movimiento" }
              : undefined,
          onClick: (row) =>
            row.kind === "instrument"
              ? addAssetMovement(row)
              : openDialog({ kind: "edit", row: row.row }),
        },
        ...(realEstate
          ? [
              {
                id: "sheet",
                icon: House,
                tooltip: "Ficha",
                hidden: (row: TenenciaRow) =>
                  row.kind !== "holding" ||
                  row.row.holding.asset_class !== "real_estate",
                label: (row: TenenciaRow) =>
                  `Ver la ficha de ${named(firstOf(row))}`,
                onClick: (row: TenenciaRow) =>
                  row.kind === "holding" &&
                  !pending &&
                  setSheet({ row: row.row }),
              },
            ]
          : []),
        ...(details
          ? [
              {
                id: "renew",
                icon: RefreshCw,
                tooltip: "Renovar",
                hidden: (row: TenenciaRow) =>
                  row.kind !== "holding" || !renewable(row.row),
                label: (row: TenenciaRow) => `Renovar ${named(firstOf(row))}`,
                onClick: (row: TenenciaRow) =>
                  row.kind === "holding" &&
                  !pending &&
                  setRenewing({ row: row.row }),
              },
            ]
          : []),
        ...(archiving
          ? [
              {
                id: "archive",
                icon: Archive,
                tooltip: "Archivar",
                hidden: isInstrument,
                label: (row: TenenciaRow) => `Archivar ${named(firstOf(row))}`,
                onClick: (row: TenenciaRow) =>
                  rowAction(
                    { kind: "archive", id: row.id },
                    () => archiving.archive(row.id),
                    MESSAGES,
                    firstOf(row),
                    "archive",
                    "Archivaste",
                  ),
              },
            ]
          : []),
        ...(deleteHolding
          ? [
              dialogs.holdingDeleteAction<TenenciaRow>(deleteHolding, (row) =>
                row.kind === "holding" ? row.row : null,
              ),
            ]
          : []),
      ],
      { pending },
    ),
  ];

  // A row being saved keeps its place until the server values it again.
  const valueOf = (row: TenenciaRow) => factsOf(row).value ?? "0";
  const sortedRows = [...rows].sort((a, b) =>
    compareDecimals(valueOf(b), valueOf(a)),
  );
  // The note counts holdings, as the total it marks does.
  const { missing } = valuation.kinds.total;
  // The cost and gain of the shown holdings with movements; none while a
  // write runs, which may change them.
  const totals =
    movement && !pending
      ? overExactSum(
          costTotals(
            shownRows.map((row) => ({
              position: movement.input.positions.get(row.id),
              value: valuation.values[row.id]?.value,
            })),
          ),
          valuation.kinds.total,
        )
      : undefined;
  const counts: Partial<Record<AssetsTab, number>> = {
    holdings: rows.length,
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
            text={holdingPlace(row.original)}
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
              MESSAGES,
              row,
              "restore",
              "Restauraste",
              HOLDING_LINKS,
            ),
        },
      ],
      { pending },
    ),
  ];

  // The sales of the chosen year: those of every holding the filters keep,
  // open or not, so they show even when no open holding matches.
  function salesPanel(input: MovementsInput): ReactNode {
    const { year } = parseAssetsParams(url.params, {
      portfolioIds: portfolios.map(({ id }) => id),
      tabs,
      salesYears: input.years,
    });
    if (year === null) {
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
                <Link href="/accounts">Cuentas</Link>.
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
            href={scopeLink(hrefs, "account")}
          />
        ) : tab === "portfolios" ? (
          <PortfoliosBreakdown
            rows={shownRows}
            portfolios={valuation.portfolios}
            total={valuation.kinds.total}
            unit={unit}
            pending={pending}
            href={scopeLink(hrefs, "portfolio")}
          />
        ) : (
          <DataTable<TenenciaRow>
            columns={tableColumns}
            data={sortedRows}
            caption="Tenencias"
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

  // A new holding, and then what a placement at a rate is when it is not a
  // plazo fijo.
  async function createWithPlacement(fields: HoldingFields) {
    const created = await actions.create(toInsert(fields));
    const kind = fields.placement;
    if (
      !created.ok ||
      !details ||
      fields.assetClass !== "fixed_term" ||
      kind === undefined ||
      kind === "fixed_term"
    ) {
      return created;
    }
    const placed = await details.actions.setPlacement(created.id, kind);
    return placed.ok ? created : placed;
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
        page
        title="Activos"
        description="Lo que tenés en cada cuenta, valuado con la última cotización"
        addLabel="Agregar tenencia"
        onAdd={() => openDialog({ kind: "create" })}
        secondary={movement && dialogs.addMovementButton()}
      >
        {view.active.length === 0 &&
        view.archived.length === 0 &&
        // Everything sold still leaves its sales to show.
        (movement?.input.sales.totals.count ?? 0) === 0 ? (
          <EmptyState
            icon={Wallet}
            title={
              accounts.length === 0
                ? "Primero, una cuenta"
                : "Todavía no cargaste tenencias"
            }
            actions={
              accounts.length === 0 && (
                <PageButton asChild variant="default">
                  <Link href="/accounts">Agregar una cuenta</Link>
                </PageButton>
              )
            }
          >
            {accounts.length === 0
              ? "Tus tenencias viven en las cuentas de tus brokers y bancos. Agregá la primera para empezar."
              : "Agregá tu primera tenencia, o subí el resumen de tu broker en Cargar y las armamos solas."}
          </EmptyState>
        ) : (
          <>
            <AssetsSummary
              valuation={valuation}
              unit={unit}
              pending={pending}
            />
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
                  {missingQuotesText(missing)}
                </p>
              )}
              {tab !== "sales" &&
                view.activeTruncated &&
                shownRows.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {missing < valuation.kinds.total.count && "* "}
                    {`Mostrando las ${PAGE_ROW_LIMIT} más recientes; el total no incluye las demás.`}
                  </p>
                )}
            </div>
          </>
        )}
        {archivedColumns && (
          <ArchivedList
            view={view}
            title="Tenencias"
            label="Archivadas"
            emptyText="No hay más tenencias archivadas."
            firstPageLabel="Ver las más recientes" // Its links are built with the params of the page on screen, so
            // they also wait for a filter, tab or unit that is loading.
            pending={pending || url.pending}
            columns={archivedColumns}
          />
        )}
      </SetupCard>
      {dialog?.kind === "create" && (
        <HoldingDialog
          key={dialog.attempt ?? 0}
          mode="create"
          {...dialogBase}
          placement={details && { kind: "fixed_term", today }}
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
            // Where movements are kept, an instrument comes in as an opening
            // balance, which asks for the price its units cost; one the
            // portfolio already holds is refused here, as the store would.
            if (movement && fields.assetClass === "instrument") {
              const held = view.active.some(
                (row) =>
                  row.account.id === fields.accountId &&
                  row.portfolio.id === fields.portfolioId &&
                  row.holding.asset_class === "instrument" &&
                  row.holding.instrument_symbol === fields.instrument,
              );
              if (held) {
                setDialog({
                  kind: "create",
                  initial: fields,
                  initialError: MESSAGES.duplicate,
                  attempt: (dialog.attempt ?? 0) + 1,
                });
                return false;
              }
              dialogs.openMovementDialog({
                kind: "create",
                row: null,
                initial: {
                  ...dialogs.newOperationFields(null, {
                    kind: "opening_balance",
                  }),
                  accountId: fields.accountId,
                  instrument: fields.instrument,
                  currency: currencyOf(instruments, fields.instrument),
                  parts: [
                    { portfolioId: fields.portfolioId, size: fields.amount },
                  ],
                },
              });
              return true;
            }
            const row = holdingRow(temporaryId(), fields, chosen);
            return submit(
              dialog,
              fields,
              { kind: "create", row },
              () => createWithPlacement(fields),
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
            dialog.initial ?? {
              ...initialFields(dialog.row, {
                accountId: "",
                portfolioId: "",
                today,
              }),
              ...(details && {
                inTaxReport: details.inTaxReport(assetKey(dialog.row.holding)),
              }),
            }
          }
          details={
            details && {
              origin: details.originOf(dialog.row.id),
              inTaxReport: details.inTaxReport(assetKey(dialog.row.holding)),
            }
          }
          placement={
            details && {
              kind: details.placementOf(dialog.row.id),
              today,
              renewed: details.renewalOf(dialog.row.id),
            }
          }
          initialError={dialog.initialError}
          onSubmit={(fields, chosen) => {
            const row = holdingRow(dialog.row.id, fields, chosen);
            return submit(
              dialog,
              fields,
              { kind: "update", row },
              () => saveHoldingEdit({ actions, details }, dialog.row, fields),
              "Guardaste",
              row,
            );
          }}
        />
      )}
      {movement && dialogs.render(movement)}
      {confirmDialog}
      {sheet &&
        realEstate &&
        sheet.row.holding.asset_class === "real_estate" && (
          <RealEstateDialog
            key={sheet.initialError ?? ""}
            name={name(sheet.row)}
            initial={
              sheet.initial ??
              sheetFields(realEstate.sheetOf(sheet.row.id), {
                currency: sheet.row.holding.currency,
                today,
              })
            }
            initialError={sheet.initialError}
            liabilities={realEstate.liabilities}
            unit={unit}
            figures={(next) => realEstate.figures(sheet.row, next, unit)}
            returnFocusTo={card.focusHeading}
            onClose={() => setSheet(null)}
            onSubmit={(next) => {
              const { row } = sheet;
              return card.dialogAction(
                null,
                () => realEstate.save(row.id, next),
                MESSAGES,
                {
                  done: `Guardaste la ficha de ${named(row)}`,
                  reopen: (error) =>
                    setSheet({
                      row,
                      initial: sheetFields(next, {
                        currency: row.holding.currency ?? "ARS",
                        today,
                      }),
                      initialError: error,
                    }),
                },
              );
            }}
          />
        )}
      {renewing &&
        details &&
        renewing.row.holding.asset_class === "fixed_term" && (
          <RenewDialog
            key={renewing.initialError ?? ""}
            name={name(renewing.row)}
            placement={renewing.row.holding}
            today={today}
            initialError={renewing.initialError}
            returnFocusTo={card.focusHeading}
            onClose={() => setRenewing(null)}
            onSubmit={(input) => {
              const { row } = renewing;
              return card.dialogAction(
                null,
                () => details.actions.renew(row.id, input),
                MESSAGES,
                {
                  done: `Renovaste ${named(row)}`,
                  reopen: (error) => setRenewing({ row, initialError: error }),
                },
              );
            }}
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
          onDelete={(date) => {
            const { symbol } = priceDialog;
            confirm({
              title: `¿Borrar el precio manual de ${symbol}?`,
              description:
                "Vuelve a valer el precio manual anterior, si cargaste otro. No se puede deshacer.",
              run: () =>
                card.dialogAction(
                  null,
                  () => prices.actions.delete!(symbol, date),
                  PRICE_MESSAGES,
                  {
                    done: `Borraste el precio manual de ${symbol}`,
                    reopen: (error) =>
                      setPriceDialog({ symbol, initialError: error }),
                  },
                ),
            });
            return true;
          }}
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
  onDelete,
}: {
  state: PriceDialogState;
  instruments: InstrumentRow[];
  prices: ManualPrices;
  today: string;
  returnFocusTo: () => HTMLElement | null;
  onClose: () => void;
  onSubmit: (fields: PriceFields, instrument: InstrumentRow) => boolean;
  onDelete: (date: string) => boolean;
}) {
  const instrument = instruments.find((each) => each.symbol === state.symbol);
  if (!instrument) return null;
  const latest = prices.manual.get(state.symbol);
  return (
    <PriceDialog
      instrument={instrument}
      initial={
        state.initial ?? priceFields(instrument.type, latest ?? null, today)
      }
      initialError={state.initialError}
      today={today}
      overrides={prices.fed.has(state.symbol)}
      returnFocusTo={returnFocusTo}
      onClose={onClose}
      onSubmit={(fields) => onSubmit(fields, instrument)}
      onDelete={
        latest && prices.actions.delete
          ? () => onDelete(latest.date)
          : undefined
      }
    />
  );
}
