"use client";

import { shownTicker } from "@plant/shared";

import { InstrumentAlert } from "@/components/holdings/instrument-alert";
import { PageCrumbs } from "@/components/layout/page-crumbs";
import { EmptyState } from "@/components/ui/empty-state";
import type { AlertWriteResult, NewAlert } from "@/lib/alerts/alerts";
import { routeItemForPath } from "@/lib/navigation";
import { type Denominator, type PriceSource } from "@plant/core";
import type { ColumnDef } from "@tanstack/react-table";
import { ArrowLeftRight, Wallet } from "lucide-react";
import { useId } from "react";
import { toast } from "sonner";

import { dialogAnswer } from "@/components/portfolio-setup/answers";
import type { ListChange } from "@/components/portfolio-setup/list-change";
import { useOptimisticWrites } from "@/components/portfolio-setup/optimistic-writes";
import {
  ExcludedAccountsNote,
  ReportSwitch,
} from "@/components/portfolio-setup/report-switch";
import { useSetupCard } from "@/components/portfolio-setup/setup-card";
import { useConfirm } from "@/components/ui/confirm-dialog";
import {
  DataTable,
  TruncatedText,
  actionsColumn,
} from "@/components/ui/data-table";
import {
  formatAmount,
  formatQuantity,
  formatFraction,
} from "@/lib/format/amount";
import { formatDate } from "@/lib/format/date";
import { assetKey, distinct } from "@/lib/holdings/assets-rows";
import { HOLDING_CLASS_LABELS } from "@/lib/holdings/classes";
import {
  holdingInSentence,
  holdingPlace,
  instrumentNames,
} from "@/lib/holdings/holding-name";
import type {
  InstrumentHolding,
  InstrumentSummary,
} from "@/lib/holdings/instrument-history";
import type { MovementsInput } from "@/lib/holdings/movements-input";
import { formatQuotedPrice } from "@/lib/holdings/price-input";
import type { HoldingRow, InstrumentRow } from "@/lib/holdings/read";
import { accountInTaxReport } from "@/lib/holdings/tax-report";
import type {
  HoldingActions,
  MovementActions,
} from "@/lib/holdings/write-actions";
import { WRITE_MESSAGES } from "@/lib/portfolio-setup/messages";
import type {
  PortfolioRow,
  SourceConnectionRow,
} from "@/lib/portfolio-setup/read";
import type { KeysetParams } from "@/lib/supabase/keyset";

import type { HoldingDetails } from "./assets-setup";
import { useAssetsUrl } from "./assets-url";
import { UnitSelect } from "./filter-select";
import { AccountCell, ImportOrigin, TickerChip } from "./holding-cells";
import {
  applyInstrumentChange,
  type ShownInstrumentHolding,
} from "./instrument-change";
import { instrumentPreset, useMovementDialogs } from "./movement-dialogs";
import { MovementsTable } from "./movements-table";
import {
  AmountText,
  CALCULATING,
  GainLossText,
  MissingFigure,
  NO_QUOTE,
  NUMBER_CELL,
} from "./sum-text";
import { StatTile } from "@/components/ui/stat-tile";

type Row = ShownInstrumentHolding & { id: string };

// The page's holdings and whether the asset counts in the report (null on a
// page without that choice), each shown before its write is saved.
type PageState = {
  holdings: readonly ShownInstrumentHolding[];
  inTaxReport: boolean | null;
};
type PageChange =
  ListChange<HoldingRow> | null | { kind: "in_tax_report"; on: boolean };

const applyPageChange = (state: PageState, change: PageChange): PageState =>
  change?.kind === "in_tax_report"
    ? { ...state, inTaxReport: change.on }
    : { ...state, holdings: applyInstrumentChange(state.holdings, change) };

const money = (value: string | null | undefined, unit: Denominator) => (
  <AmountText amount={value} unit={unit} />
);

// Everything that happened to one instrument, in every account and
// portfolio: what it is worth and what it made, where it is held, and each
// movement, newest first. Each holding's movements and its delete are written
// here.
export function InstrumentHistory({
  instrument,
  price,
  unit,
  referenceUnit,
  params,
  backHref,
  holdings,
  summary,
  movements,
  movementActions,
  actions,
  details,
  accounts,
  portfolios,
  instruments,
  today,
  onAlert,
}: {
  instrument: InstrumentRow;
  // One unit's price in the page's unit, and where it came from.
  price: { value: string | null; source: PriceSource; date: string | null };
  unit: Denominator;
  referenceUnit: Denominator;
  params: KeysetParams;
  backHref: string;
  holdings: readonly InstrumentHolding[];
  summary: InstrumentSummary;
  movements: Pick<
    MovementsInput,
    | "positions"
    | "revisions"
    | "transferCost"
    | "quoteOn"
    | "loadMovements"
    | "firstMovements"
  >;
  movementActions: MovementActions;
  // A page that deletes holdings, each with its movements.
  actions: Pick<HoldingActions, "delete">;
  details?: HoldingDetails;
  accounts: SourceConnectionRow[];
  portfolios: PortfolioRow[];
  instruments: InstrumentRow[];
  today: string;
  // Sets a price alert on this instrument, from the bell.
  onAlert: (alert: NewAlert) => Promise<AlertWriteResult>;
}) {
  const url = useAssetsUrl(params);
  const unitId = useId();
  const key = holdings[0] && assetKey(holdings[0].row.holding);
  const {
    shown: page,
    pending,
    run,
  } = useOptimisticWrites<PageState, PageChange>(
    {
      holdings,
      inTaxReport: details && key ? details.inTaxReport(key) : null,
    },
    applyPageChange,
  );
  const shown = page.holdings;
  const { heading, focusHeading, rowAction, dialogAction } = useSetupCard({
    run,
    pending,
  });
  const names = instrumentNames(instruments);
  const { confirm, dialog: confirmDialog } = useConfirm(focusHeading);
  const active = shown.map((each) => each.row);
  const dialogs = useMovementDialogs({
    card: { focusHeading, rowAction, dialogAction },
    active,
    accounts,
    portfolios,
    instruments,
    today,
    names,
    confirm,
    pending,
  });
  const movement = { input: movements, actions: movementActions };
  const returns = summary.returns;
  const byId = new Map(active.map((row) => [row.id, row]));
  // Changes when any of its movements does, so the list reads them again.
  const revision = holdings
    .map((each) => movements.revisions.get(each.row.id) ?? 0)
    .join(".");
  const taxId = `${unitId}-tax`;
  // Where it is still held: a sold holding's account does not hold it.
  const held = shown.filter((each) => !each.closed);
  const accountsExcluded =
    held.length > 0 &&
    held.every((each) => !accountInTaxReport(accounts, each.row.account.id));

  // The switch keeps focus; the answer is a toast, and a refusal puts it back.
  function setInTaxReport(on: boolean) {
    if (!details || !key) return;
    run(
      { kind: "in_tax_report", on },
      () => details.actions.setInTaxReport(key, on),
      (result) => dialogAnswer(result, WRITE_MESSAGES.holdings),
      (answer) => {
        if (answer.kind === "done") {
          toast.success(
            on
              ? `Incluiste ${shownTicker(instrument.symbol)} en el reporte`
              : `Sacaste ${shownTicker(instrument.symbol)} del reporte`,
          );
        } else if (answer.kind === "alert") toast.error(answer.text);
      },
    );
  }

  const columns: ColumnDef<Row>[] = [
    {
      id: "account",
      header: "Cuenta",
      cell: ({ row: { original } }) => {
        const origin = details?.originOf(original.row.id);
        return (
          <>
            <AccountCell institution={original.row.account.institution} />
            <TruncatedText
              className="text-xs text-muted-foreground @2xl:hidden"
              text={`${
                original.closed
                  ? "Vendida"
                  : `${formatQuantity(original.position.quantity)} ${shownTicker(instrument.symbol)}`
              } · ${original.row.portfolio.name}`}
            />
            {origin?.kind === "import" && (
              <ImportOrigin
                origin={origin}
                className="block truncate text-xs text-muted-foreground"
              />
            )}
          </>
        );
      },
    },
    {
      id: "portfolio",
      header: "Cartera",
      meta: { className: "hidden @2xl:table-cell text-muted-foreground" },
      cell: ({ row: { original } }) => (
        <TruncatedText text={original.row.portfolio.name} />
      ),
    },
    {
      id: "quantity",
      header: "Cantidad",
      size: 128,
      meta: { className: `hidden @2xl:table-cell ${NUMBER_CELL}` },
      cell: ({ row: { original } }) =>
        original.closed
          ? "Vendida"
          : formatQuantity(original.position.quantity),
    },
    {
      id: "cost",
      header: "Costo",
      size: 144,
      meta: { className: `hidden @3xl:table-cell ${NUMBER_CELL}` },
      cell: ({ row: { original } }) =>
        original.closed
          ? null
          : original.unsaved
            ? CALCULATING
            : money(original.position.money?.cost, unit),
    },
    {
      id: "value",
      header: "Valor",
      meta: { className: `w-30 @2xl:w-36 ${NUMBER_CELL}` },
      cell: ({ row: { original } }) =>
        original.closed
          ? null
          : original.unsaved
            ? CALCULATING
            : money(original.value, unit),
    },
    actionsColumn<Row>(
      [
        {
          id: "add",
          icon: ArrowLeftRight,
          tooltip: "Agregar movimiento",
          label: (row) =>
            `Agregar movimiento de ${holdingInSentence(row.row, names)}`,
          hidden: (row) => row.closed,
          onClick: (row) =>
            dialogs.openMovementDialog({ kind: "create", row: row.row }),
        },
        ...(actions.delete
          ? [dialogs.holdingDeleteAction<Row>(actions.delete, (row) => row.row)]
          : []),
      ],
      { pending },
    ),
  ];

  return (
    <div className="grid gap-4" data-slot="setup-section">
      <p role="status" className="sr-only">
        {pending ? "Guardando…" : ""}
      </p>
      <PageCrumbs
        crumbs={[
          {
            label: routeItemForPath(backHref)?.title ?? "Activos",
            href: backHref,
          },
          { label: instrument.name },
        ]}
      />
      <div className="flex min-h-7 flex-wrap items-center gap-x-4 gap-y-2">
        <h1 ref={heading} tabIndex={-1} className="sr-only">
          {instrument.name}
        </h1>
        <TickerChip ticker={instrument.symbol} />
        {/* The class and price; the page values the price from a holding of
            it, so the line goes with the last one. */}
        {shown.length > 0 && (
          <p className="text-muted-foreground text-xs">
            {HOLDING_CLASS_LABELS[instrument.type]} ·{" "}
            {price.value === null
              ? NO_QUOTE
              : `${formatQuotedPrice(price.value, unit, instrument.type)} ${
                  price.source === "manual" && price.date
                    ? `(manual, ${formatDate(price.date)})`
                    : price.date
                      ? `al ${formatDate(price.date)}`
                      : ""
                }`}
          </p>
        )}
        <div className="ml-auto flex items-center gap-2" data-print="hidden">
          {/* Alerts are in pesos or dollars. */}
          {instrument.currency !== "EUR" && (
            <InstrumentAlert
              symbol={instrument.symbol}
              currency={instrument.currency}
              held={shown.length > 0}
              onCreate={onAlert}
            />
          )}
          {shown.length > 0 && (
            <UnitSelect
              id={unitId}
              unit={unit}
              referenceUnit={referenceUnit}
              pending={pending}
              onChange={(param) => url.set("unit", param)}
              triggerClassName="w-auto"
            />
          )}
        </div>
      </div>

      {shown.length === 0 ? (
        <EmptyState icon={Wallet} title={`No tenés ${instrument.name}`}>
          Cuando lo compres o lo cargues en alguna cuenta, vas a ver acá cuánto
          tenés y su historial.
        </EmptyState>
      ) : (
        <>
          {page.inTaxReport !== null && (
            <div className="max-w-sm">
              <ReportSwitch
                id={taxId}
                checked={page.inTaxReport}
                pending={pending}
                onCheckedChange={setInTaxReport}
                note={
                  accountsExcluded && (
                    <ExcludedAccountsNote
                      institutions={distinct(
                        held.map((each) => each.row.account),
                      ).map((each) => each.institution)}
                      subject="asset"
                    />
                  )
                }
              />
            </div>
          )}
          <div
            className={`grid gap-3 ${pending ? "opacity-60" : ""}`}
            aria-busy={pending || undefined}
          >
            <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatTile
                label="Valor actual"
                note={`${formatQuantity(summary.quantity)} ${shownTicker(instrument.symbol)}`}
              >
                {money(summary.value, unit)}
              </StatTile>
              <StatTile
                label="Resultado total"
                note={
                  returns?.share == null
                    ? "Ventas, cobros y lo que tenés hoy"
                    : `${formatFraction(returns.share)} sobre lo invertido`
                }
              >
                {returns ? (
                  <GainLossText
                    gain={{ amount: returns.result, percent: null }}
                    unit={unit}
                  />
                ) : (
                  <MissingFigure text="Sin resultado" />
                )}
              </StatTile>
              <StatTile
                label="Rendimiento anual (TIR)"
                note={
                  returns && returns.annual === null
                    ? "Con menos de un año no se anualiza"
                    : "Según cuándo pusiste y sacaste plata"
                }
              >
                {returns?.annual != null ? (
                  formatFraction(returns.annual)
                ) : (
                  <MissingFigure text="Sin rendimiento anual" />
                )}
              </StatTile>
              <StatTile
                label="G/P no realizada"
                note="De lo que tenés hoy, sobre su costo"
              >
                <GainLossText gain={summary.unrealized} unit={unit} />
              </StatTile>
            </dl>
            <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatTile label="Costo de lo que tenés">
                {money(summary.cost, unit)}
              </StatTile>
              <StatTile label="Resultado realizado">
                {money(summary.realized, unit)}
              </StatTile>
              <StatTile label="Dividendos, cupones y rendimientos">
                {money(summary.income, unit)}
              </StatTile>
              <StatTile label="Gastos">{money(summary.charges, unit)}</StatTile>
            </dl>
            {returns && (
              <p className="text-muted-foreground text-xs">
                {`Pusiste ${formatAmount(returns.paidIn, unit)} y sacaste ${formatAmount(
                  returns.paidOut,
                  unit,
                )} entre ventas y cobros, cada monto a la cotización de su fecha.`}
              </p>
            )}
          </div>

          <section className="grid gap-3" aria-labelledby={`${unitId}-where`}>
            <div className="grid gap-1">
              <h2 id={`${unitId}-where`} className="text-sm font-semibold">
                Dónde lo tenés
              </h2>
              <p className="text-muted-foreground text-xs">
                Cuánto tenés en cada cuenta y cartera.
              </p>
            </div>
            <DataTable
              caption={`Tenencias de ${instrument.name}`}
              columns={columns}
              data={shown.map((each) => ({ ...each, id: each.row.id }))}
            />
          </section>

          <section className="grid gap-3" aria-labelledby={`${unitId}-history`}>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="grid gap-1">
                <h2 id={`${unitId}-history`} className="text-sm font-semibold">
                  Historial
                </h2>
                <p className="text-muted-foreground text-xs">
                  Cada compra, venta, rendimiento y traspaso, el más reciente
                  primero.
                </p>
              </div>
              {dialogs.addMovementButton(
                instrumentPreset(
                  instrument.symbol,
                  shown.flatMap((each) => (each.closed ? [] : [each.row])),
                ),
              )}
            </div>
            <MovementsTable
              key={`${revision}:${unit}`}
              scope={{ symbol: instrument.symbol }}
              unit={unit}
              instrumentTypes={new Map([[instrument.symbol, instrument.type]])}
              load={movements.loadMovements}
              first={movements.firstMovements}
              holdingName={(id) => {
                const row = byId.get(id);
                return row ? holdingPlace(row) : "";
              }}
              actions={dialogs.movementLineActions(movement, (line) =>
                byId.get(line.movement.holding_id),
              )}
              pending={pending}
            />
          </section>
        </>
      )}
      {dialogs.render(movement)}
      {confirmDialog}
    </div>
  );
}
