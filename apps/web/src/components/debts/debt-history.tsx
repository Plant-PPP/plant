"use client";

import {
  admitLiabilityEvent,
  admitLiabilityEventDeletion,
  admitLiabilityUpdate,
  compareLiabilityEvents,
  type Denominator,
  type Installment,
  type InstallmentStatus,
  type Liability,
  type LiabilityEvent,
  type LiabilityEventKind,
  type QuoteSnapshot,
  type ReferenceDollar,
  isOwed,
  liabilitiesOn,
  liabilityBalance,
  loanToValue,
  takesCashLink,
  takesEvents,
  valueLiabilities,
  principalSplit,
} from "@plant/core";
import { sumOrNull } from "@plant/shared";
import type { ColumnDef } from "@tanstack/react-table";
import {
  CalendarClock,
  HandCoins,
  MoreHorizontal,
  Pencil,
  Percent,
  Scale,
  ShieldCheck,
  Trash2,
  CircleCheck,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";

import { usePreload } from "@/hooks/use-preload";
import { useAssetsUrl } from "@/components/holdings/assets-url";
import { UnitSelect } from "@/components/holdings/filter-select";
import {
  CALCULATING,
  MissingFigure,
  NO_QUOTE,
  NUMBER_CELL,
} from "@/components/holdings/sum-text";
import { PageCrumbs } from "@/components/layout/page-crumbs";
import { temporaryId } from "@/components/portfolio-setup/list-change";
import { useOptimisticWrites } from "@/components/portfolio-setup/optimistic-writes";
import {
  type Retry,
  useSetupCard,
} from "@/components/portfolio-setup/setup-card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  DataTable,
  TruncatedText,
  actionsColumn,
} from "@/components/ui/data-table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PageButton } from "@/components/ui/page-button";
import { PageHeader } from "@/components/ui/page-header";
import { Section } from "@/components/ui/section";
import { StatGrid, StatTile } from "@/components/ui/stat-tile";
import { DEBT_EVENT_LABELS } from "@/lib/debts/labels";
import { planOf } from "@/lib/debts/plans";
import type { DebtEventResult } from "@/lib/debts/events-write";
import { amountInput, formatAmount, formatFraction } from "@/lib/format/amount";
import { formatDate } from "@/lib/format/date";
import type { InstrumentRow } from "@/lib/holdings/read";
import { UNIT_LABELS } from "@/lib/holdings/messages";
import {
  FAILED,
  WRITE_MESSAGES,
  type WriteMessages,
} from "@/lib/portfolio-setup/messages";
import type { WriteResult } from "@/lib/portfolio-setup/write-result";
import { settle } from "@/lib/server-action-call";
import type { KeysetParams } from "@/lib/supabase/keyset";

import type { PledgeOption } from "./debt-collateral-dialog";
import {
  DebtDisbursementDialog,
  type DisbursementChoice,
} from "./debt-disbursement-dialog";
import {
  DebtCollateralDialog,
  DebtDialog,
  DebtEventDialog,
  DebtInstallmentsDialog,
  preloadDebtDialogs,
} from "./lazy-dialogs";
import {
  type CashOption,
  CASH_NOT_RESTORED,
  DEBT_EVENT_MESSAGES,
  type DebtEventFields,
  eventFields,
  toCashInput,
  toEventInput,
} from "./debt-event-fields";
import {
  type DebtFields,
  DEBT_DELETE_DESCRIPTION,
  debtAmount,
  debtFields,
  LIABILITY_KIND_LABELS,
  toLiabilityInput,
  unitOf,
} from "./debt-fields";
import { type DebtActions, DEBT_MESSAGES } from "./debts-setup";

export type DebtEventActions = {
  record: (
    debtId: string,
    event: unknown,
    cash: unknown,
  ) => Promise<DebtEventResult>;
  update: (
    eventId: string,
    event: unknown,
    cash: unknown,
  ) => Promise<DebtEventResult>;
  delete: (eventId: string) => Promise<DebtEventResult>;
};

export type DebtPageActions = {
  events: DebtEventActions;
  debts: Pick<DebtActions, "update" | "delete">;
  collateral: (debtId: string, holdingIds: string[]) => Promise<WriteResult>;
  // Absent where the debt's disbursement cannot be named (the prototype).
  disbursement?: (
    debtId: string,
    operationId: string | null,
  ) => Promise<WriteResult>;
  installments: (
    debtId: string,
    installments: Installment[],
  ) => Promise<WriteResult>;
};

type EventRow = LiabilityEvent & { unsaved?: true };

const OPENED_AFTER_EVENTS =
  "La fecha del saldo es posterior al primer movimiento: elegí una igual o anterior.";

const REOPENING_KEPT =
  "Este ajuste reabrió la deuda y hay movimientos después: borralos primero.";

const INSTALLMENT_STATUS_LABELS: Record<InstallmentStatus, string> = {
  paid: "Pagada",
  partial: "Parcial",
  pending: "Pendiente",
};

type InstallmentRow = Installment & {
  id: string;
  status: InstallmentStatus;
  owed: string;
};

const COLLATERAL_MESSAGES: WriteMessages = {
  ...WRITE_MESSAGES.holdings,
  duplicate: FAILED,
  invalid: FAILED,
  not_found: "Algún activo cambió hace un momento. Probá de nuevo.",
  failed: FAILED,
};

type State = {
  debt: Liability & { unsaved?: true };
  events: EventRow[];
  collateral: string[];
  disbursement: string | null;
  installments: Installment[];
};

type Change =
  | { kind: "debt"; debt: Liability }
  | { kind: "event"; row: EventRow }
  | { kind: "delete_event"; id: string }
  | { kind: "collateral"; ids: string[] }
  | { kind: "disbursement"; operationId: string | null }
  | { kind: "installments"; installments: Installment[] };

function apply(state: State, change: Change): State {
  switch (change.kind) {
    case "debt":
      return { ...state, debt: { ...change.debt, unsaved: true } };
    case "event": {
      const rest = state.events.filter((each) => each.id !== change.row.id);
      return { ...state, events: [...rest, change.row] };
    }
    case "delete_event":
      return {
        ...state,
        events: state.events.filter((each) => each.id !== change.id),
      };
    case "collateral":
      return { ...state, collateral: change.ids };
    case "disbursement":
      return { ...state, disbursement: change.operationId };
    case "installments":
      return { ...state, installments: change.installments };
  }
}

// The debt as an edit leaves it, before the server answers: the fields the
// form sends over the row. An emptied opening date keeps the old anchor until
// the page reloads the day the database falls back to.
export const editedDebt = (
  debt: Liability,
  input: ReturnType<typeof toLiabilityInput>,
): Liability =>
  ({
    ...debt,
    ...input,
    id: debt.id,
    anchored_on: input.opened_on ?? debt.anchored_on,
  }) as Liability;

// A dialog's write as the dialog gave it, and the event it shows meanwhile.
function eventRow(
  debt: Liability,
  fields: DebtEventFields,
  previous: LiabilityEvent | null,
): EventRow {
  const input = toEventInput(fields);
  const payment = fields.kind === "payment";
  return {
    id: previous?.id ?? temporaryId(),
    liability_id: debt.id,
    // A new event is entered after every other on its day.
    created_at: previous?.created_at ?? "￿",
    kind: fields.kind,
    date: fields.date,
    amount: "amount" in input ? String(input.amount) : null,
    annual_rate: "annual_rate" in input ? String(input.annual_rate) : null,
    cash_holding_id:
      payment && fields.cashHoldingId ? fields.cashHoldingId : null,
    takes_cash: payment && fields.cashHoldingId !== "" && fields.take,
    settles: payment && fields.settles,
    unsaved: true,
  } as EventRow;
}

type EventDialog = {
  kind: LiabilityEventKind;
  event: LiabilityEvent | null;
  prefill?: Partial<DebtEventFields>;
} & Retry<DebtEventFields>;

// One debt: its balance and rate today, what it costs a day and this month,
// what is pledged for it, and every event after its opening. Its events are
// recorded, edited and deleted here; the figures follow at once.
export function DebtHistory({
  debt: initialDebt,
  events: initialEvents,
  collateral: initialCollateral,
  installments: initialInstallments = [],
  complete,
  today,
  snapshot,
  unit,
  referenceUnit,
  referenceDollar,
  params,
  instruments,
  cash,
  pledgeOptions,
  disbursement = { current: null, options: [] },
  actions,
}: {
  debt: Liability;
  events: readonly LiabilityEvent[];
  collateral: readonly string[];
  // The debt's installment plan, empty without one.
  installments?: readonly Installment[];
  // Whether every event was read.
  complete: boolean;
  today: string;
  snapshot: QuoteSnapshot;
  unit: Denominator;
  referenceUnit: Denominator;
  referenceDollar: ReferenceDollar;
  params: KeysetParams;
  instruments: InstrumentRow[];
  // The cash holdings a payment can come from, in the debt's currency.
  cash: readonly CashOption[];
  pledgeOptions: readonly PledgeOption[];
  // The deposit that brought the loan's money in, and the ones that could
  // have.
  disbursement?: {
    current: string | null;
    options: readonly DisbursementChoice[];
  };
  actions: DebtPageActions;
}) {
  const { shown, pending, run } = useOptimisticWrites<State, Change>(
    {
      debt: initialDebt,
      events: [...initialEvents],
      collateral: [...initialCollateral],
      disbursement: disbursement.current,
      installments: [...initialInstallments],
    },
    apply,
  );
  const card = useSetupCard({ run, pending });
  usePreload(preloadDebtDialogs);
  const { heading } = card;
  const url = useAssetsUrl(params);
  const router = useRouter();
  const [deleting, startDelete] = useTransition();
  const id = useId();
  const [eventDialog, setEventDialog] = useState<EventDialog | null>(null);
  const [debtDialog, setDebtDialog] = useState<Retry<DebtFields> | null>(null);
  const [collateralDialog, setCollateralDialog] = useState<Retry<
    string[]
  > | null>(null);
  const [disbursementDialog, setDisbursementDialog] = useState<Retry<
    string | null
  > | null>(null);
  const [installmentsDialog, setInstallmentsDialog] = useState<Retry<
    Installment[]
  > | null>(null);
  const [deletingEvent, setDeletingEvent] = useState<LiabilityEvent | null>(
    null,
  );
  const [deletingDebt, setDeletingDebt] = useState(false);

  const debt = shown.debt;
  const busy = pending || deleting;
  const history = takesEvents(debt.kind);
  const linksCash = takesCashLink(debt);
  const figure = liabilityBalance(debt, shown.events, today);
  const [owed] = liabilitiesOn([debt], new Map([[debt.id, figure]]));
  const valued = valueLiabilities([owed!], snapshot, {
    denominator: unit,
    referenceDollar,
  });
  const value = valued.items[0]?.value ?? null;
  const split = principalSplit(figure.balance, debt.principal);
  // A part of the balance in the view's unit, or null without its quote.
  const partValue = (part: string) =>
    valueLiabilities([{ ...owed!, balance: part }], snapshot, {
      denominator: unit,
      referenceDollar,
    }).items[0]?.value ?? null;
  const partNote = (part: string) => {
    const shownValue = partValue(part);
    return shownValue === null ? NO_QUOTE : formatAmount(shownValue, unit);
  };
  // A pledged holding the user no longer holds stays in the dialog, so it can
  // be unpledged, and out of the figures: it has no value to count.
  const known = new Set(pledgeOptions.map((each) => each.id));
  const options: PledgeOption[] = [
    ...pledgeOptions,
    ...shown.collateral
      .filter((id) => !known.has(id))
      .map((id) => ({
        id,
        label: "Un activo que ya no tenés",
        place: "Ya no está en tus cuentas",
        value: null,
      })),
  ];
  const pledged = pledgeOptions.filter((each) =>
    shown.collateral.includes(each.id),
  );
  const pledgedValue = sumOrNull(pledged.map((each) => each.value));
  const ltv =
    value !== null && pledgedValue !== null && pledged.length > 0
      ? loanToValue(value, pledgedValue)
      : null;
  const cashOf = new Map(cash.map((each) => [each.id, each]));
  const plan =
    shown.installments.length > 0
      ? planOf(shown.installments, shown.events)
      : null;
  const installmentRows: InstallmentRow[] = (plan?.installments ?? []).map(
    (each, index) => ({ ...each, id: `${index}` }),
  );
  // Newest first, in the reverse of the order core applies them.
  const rows = [...shown.events].sort((a, b) => compareLiabilityEvents(b, a));

  // What a debt's rules say about the event the dialog would write.
  const check = (dialog: EventDialog) => (fields: DebtEventFields) => {
    const row = eventRow(debt, fields, dialog.event);
    const hint = admitLiabilityEvent(
      debt,
      shown.events,
      { ...row, id: dialog.event?.id },
      today,
    );
    return hint === null ? null : DEBT_EVENT_MESSAGES[hint];
  };

  // Warns when cash a payment took could not go back to its account.
  const warned = async (call: Promise<DebtEventResult>) => {
    const result = await call;
    if (result.ok && !result.cashRestored) toast.warning(CASH_NOT_RESTORED);
    return result;
  };

  function submitEvent(dialog: EventDialog, fields: DebtEventFields) {
    const row = eventRow(debt, fields, dialog.event);
    const event = toEventInput(fields);
    const cashInput = toCashInput(fields, cash);
    return card.dialogAction(
      { kind: "event", row },
      () =>
        dialog.event
          ? warned(actions.events.update(dialog.event.id, event, cashInput))
          : actions.events.record(debt.id, event, cashInput),
      DEBT_EVENT_MESSAGES,
      {
        done: dialog.event
          ? `Guardaste el ${DEBT_EVENT_LABELS[fields.kind].toLowerCase()}`
          : `Registraste el ${DEBT_EVENT_LABELS[fields.kind].toLowerCase()}`,
        reopen: (error) =>
          setEventDialog({ ...dialog, initial: fields, initialError: error }),
      },
    );
  }

  // What the debt's events say about an edit of its opening.
  const checkDebt = (fields: DebtFields): string | null => {
    const hint = admitLiabilityUpdate(
      debt,
      toLiabilityInput(fields),
      shown.events,
      // The day it was created, which the page knows only while the debt
      // has no opening date of its own; otherwise the database decides.
      debt.opened_on === null ? debt.anchored_on : "",
      today,
    );
    return hint === null
      ? null
      : hint === "before_opening"
        ? OPENED_AFTER_EVENTS
        : DEBT_EVENT_MESSAGES[hint];
  };

  function submitDebt(retry: Retry<DebtFields>, fields: DebtFields) {
    const input = toLiabilityInput(fields);
    return card.dialogAction(
      {
        kind: "debt",
        debt: editedDebt(debt, input),
      },
      () => actions.debts.update(debt.id, input),
      DEBT_MESSAGES,
      {
        done: `Guardaste ${fields.label.trim()}`,
        reopen: (error) =>
          setDebtDialog({ ...retry, initial: fields, initialError: error }),
      },
    );
  }

  function deleteDebt() {
    startDelete(async () => {
      const result = await settle(actions.debts.delete(debt.id));
      if (result !== "rejected" && result.ok) {
        toast.success(`Borraste ${debt.label}`);
        router.push("/debts");
      } else {
        toast.error(FAILED);
      }
    });
  }

  const openEvent = (
    kind: LiabilityEventKind,
    prefill?: Partial<DebtEventFields>,
  ) => !busy && setEventDialog({ kind, event: null, prefill });

  const amountCell = (event: EventRow) =>
    event.kind === "rate_change"
      ? formatFraction(event.annual_rate!)
      : debtAmount(debt, event.amount!);

  const detailOf = (event: EventRow) =>
    [
      event.settles ? "Cancela la deuda" : null,
      event.cash_holding_id
        ? `${event.takes_cash ? "Salió de" : "Desde"} ${
            cashOf.get(event.cash_holding_id)?.label ??
            "una cuenta que ya no está activa"
          }`
        : null,
    ]
      .filter(Boolean)
      .join(" · ");

  const columns: ColumnDef<EventRow>[] = [
    {
      id: "date",
      header: "Fecha",
      size: 104,
      meta: { className: "text-muted-foreground whitespace-nowrap" },
      cell: ({ row: { original } }) => formatDate(original.date),
    },
    {
      id: "event",
      header: "Movimiento",
      cell: ({ row: { original } }) => (
        <>
          <TruncatedText
            className="font-medium"
            text={DEBT_EVENT_LABELS[original.kind]}
          />
          {detailOf(original) && (
            <TruncatedText
              className="text-muted-foreground text-xs"
              text={detailOf(original)}
            />
          )}
        </>
      ),
    },
    {
      id: "amount",
      header: "Monto",
      size: 152,
      meta: { className: NUMBER_CELL },
      cell: ({ row: { original } }) => amountCell(original),
    },
    actionsColumn<EventRow>(
      [
        {
          id: "edit",
          icon: Pencil,
          tooltip: "Editar",
          label: (event) =>
            `Editar ${DEBT_EVENT_LABELS[event.kind].toLowerCase()} del ${formatDate(event.date)}`,
          onClick: (event) =>
            !busy &&
            setEventDialog({
              kind: event.kind,
              event: event as LiabilityEvent,
            }),
        },
        {
          id: "delete",
          icon: Trash2,
          tooltip: "Borrar",
          label: (event) =>
            `Borrar ${DEBT_EVENT_LABELS[event.kind].toLowerCase()} del ${formatDate(event.date)}`,
          onClick: (event) => {
            if (busy) return;
            // Deleting what reopened a debt under a later event is refused.
            if (admitLiabilityEventDeletion(shown.events, event.id)) {
              toast.error(REOPENING_KEPT);
              return;
            }
            setDeletingEvent(event);
          },
        },
      ],
      { pending: busy },
    ),
  ];

  const installmentColumns: ColumnDef<InstallmentRow>[] = [
    {
      id: "date",
      header: "Fecha",
      size: 104,
      meta: { className: "text-muted-foreground whitespace-nowrap" },
      cell: ({ row: { original } }) => formatDate(original.due_on),
    },
    {
      id: "amount",
      header: "Monto",
      size: 152,
      meta: { className: NUMBER_CELL },
      cell: ({ row: { original } }) => debtAmount(debt, original.amount),
    },
    {
      id: "status",
      header: "Estado",
      cell: ({ row: { original } }) => (
        <>
          <span
            className={
              original.status === "paid" ? "text-muted-foreground" : undefined
            }
          >
            {INSTALLMENT_STATUS_LABELS[original.status]}
          </span>
          {original.status === "partial" && (
            <span className="text-muted-foreground block text-xs">
              {`Falta ${debtAmount(debt, original.owed)}`}
            </span>
          )}
        </>
      ),
    },
  ];

  const toolbarActions = (
    <>
      {history && (
        <PageButton
          variant="default"
          disabled={busy}
          onClick={() => openEvent("payment")}
        >
          <HandCoins />
          Registrar pago
        </PageButton>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild disabled={busy}>
          <PageButton
            size="icon"
            className="size-7"
            aria-label={`Más acciones de ${debt.label}`}
          >
            <MoreHorizontal />
          </PageButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {history && (
            <>
              <DropdownMenuItem
                className="text-xs"
                onSelect={() => openEvent("rate_change")}
              >
                <Percent />
                Cambiar tasa
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-xs"
                onSelect={() => openEvent("adjustment")}
              >
                <Scale />
                Ajustar saldo
              </DropdownMenuItem>
              {figure.open && (
                <DropdownMenuItem
                  className="text-xs"
                  onSelect={() =>
                    openEvent("payment", {
                      amount: amountInput(figure.balance),
                      settles: true,
                    })
                  }
                >
                  <CircleCheck />
                  Cancelar la deuda
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                className="text-xs"
                onSelect={() => !busy && setInstallmentsDialog({})}
              >
                <CalendarClock />
                Plan de cuotas
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-xs"
                onSelect={() => !busy && setCollateralDialog({})}
              >
                <ShieldCheck />
                Garantía
              </DropdownMenuItem>
              {actions.disbursement &&
                (disbursement.options.length > 0 ||
                  shown.disbursement !== null) && (
                  <DropdownMenuItem
                    className="text-xs"
                    onSelect={() => !busy && setDisbursementDialog({})}
                  >
                    <HandCoins />
                    Desembolso
                  </DropdownMenuItem>
                )}
            </>
          )}
          <DropdownMenuItem
            className="text-xs"
            onSelect={() => !busy && setDebtDialog({})}
          >
            <Pencil />
            Editar
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-destructive focus:text-destructive text-xs"
            onSelect={() => !busy && setDeletingDebt(true)}
          >
            <Trash2 className="text-destructive" />
            Borrar
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );

  const balanceNote = !complete
    ? "Puede faltar algún movimiento"
    : figure.overflow
      ? "No se pudo calcular completo"
      : !figure.open
        ? "Cancelada"
        : figure.estimated
          ? "Estimado: crece con el interés de cada día"
          : "Según el último saldo del acreedor";

  return (
    <div className="grid gap-8" data-slot="setup-section">
      <p role="status" className="sr-only">
        {pending ? "Guardando…" : ""}
      </p>
      <PageCrumbs
        crumbs={[{ label: "Deudas", href: "/debts" }, { label: debt.label }]}
      />
      <div className="grid gap-4">
        <h2 ref={heading} tabIndex={-1} className="sr-only">
          {debt.label}
        </h2>
        <PageHeader
          title={debt.label}
          filters={
            <>
              <UnitSelect
                id={`${id}-unit`}
                unit={unit}
                referenceUnit={referenceUnit}
                pending={busy}
                onChange={(param) => url.set("unit", param)}
                triggerClassName="w-auto"
              />
              <p className="text-muted-foreground text-xs">
                {[LIABILITY_KIND_LABELS[debt.kind], debt.lender]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </>
          }
          actions={toolbarActions}
        />
        <StatGrid
          className={pending ? "opacity-60" : undefined}
          aria-busy={pending || undefined}
        >
          <StatTile label="Saldo hoy" note={balanceNote}>
            {debt.unsaved ? CALCULATING : debtAmount(debt, figure.balance)}
          </StatTile>
          <StatTile
            label={UNIT_LABELS[unit]}
            note={isOwed(owed!) ? undefined : "No debés nada"}
          >
            {value === null ? (
              <MissingFigure text={NO_QUOTE} />
            ) : (
              formatAmount(value, unit)
            )}
          </StatTile>
          <StatTile
            label="Tasa anual"
            note={
              debt.accrues
                ? "Interés compuesto cada día"
                : "No acumula interés diario"
            }
          >
            {figure.rate === null ? (
              <MissingFigure text="Sin tasa" />
            ) : (
              formatFraction(figure.rate)
            )}
          </StatTile>
          {debt.accrues ? (
            <StatTile
              label="Interés por día"
              note={`${debtAmount(debt, figure.interestThisMonth)} este mes`}
            >
              {debtAmount(debt, figure.dailyInterest)}
            </StatTile>
          ) : (
            <StatTile
              label="Cuota"
              note={
                plan
                  ? plan.next
                    ? `Vence el ${formatDate(plan.next.due_on)}`
                    : undefined
                  : debt.next_due_on
                    ? `Vence el ${formatDate(debt.next_due_on)}`
                    : undefined
              }
            >
              {plan ? (
                plan.next ? (
                  debtAmount(debt, plan.next.owed)
                ) : (
                  <MissingFigure text="Todas pagadas" />
                )
              ) : debt.installment ? (
                debtAmount(debt, debt.installment)
              ) : (
                <MissingFigure text="Sin cuota" />
              )}
            </StatTile>
          )}
          {split && !debt.unsaved && (
            <>
              <StatTile label="Capital" note={partNote(split.principal)}>
                {debtAmount(debt, split.principal)}
              </StatTile>
              <StatTile label="Intereses" note={partNote(split.interest)}>
                {debtAmount(debt, split.interest)}
              </StatTile>
            </>
          )}
          {pledged.length > 0 && (
            <StatTile
              label="Garantía"
              note={
                ltv === null
                  ? "Sin cotización de algún activo"
                  : `Préstamo sobre garantía: ${formatFraction(ltv)}`
              }
            >
              {pledgedValue === null ? (
                <MissingFigure text={NO_QUOTE} />
              ) : (
                formatAmount(pledgedValue, unit)
              )}
            </StatTile>
          )}
        </StatGrid>
      </div>

      {plan && (
        <Section
          title="Plan de cuotas"
          description="Los pagos registrados cubren las cuotas en orden de fecha."
          actions={
            <PageButton
              disabled={busy}
              onClick={() => !busy && setInstallmentsDialog({})}
            >
              <Pencil />
              Editar
            </PageButton>
          }
        >
          <DataTable
            caption={`Cuotas de ${debt.label}`}
            columns={installmentColumns}
            data={installmentRows}
          />
        </Section>
      )}

      {history ? (
        <Section
          title="Historial"
          description="Cada pago, cambio de tasa y ajuste, el más reciente primero."
        >
          {rows.length === 0 ? (
            <p className="text-muted-foreground py-6 text-center text-xs">
              {`Todavía no registraste movimientos. El saldo parte de ${debtAmount(
                debt,
                debt.balance,
              )} al ${formatDate(debt.anchored_on)}.`}
            </p>
          ) : (
            <DataTable
              caption={`Movimientos de ${debt.label}`}
              columns={columns}
              data={rows}
              footer={
                <tr className="text-muted-foreground text-xs">
                  <td className="px-3 py-2 whitespace-nowrap">
                    {formatDate(debt.anchored_on)}
                  </td>
                  <td className="px-3 py-2">Saldo inicial</td>
                  <td className={`px-3 py-2 ${NUMBER_CELL}`}>
                    {debtAmount(debt, debt.balance)}
                  </td>
                  <td />
                </tr>
              }
            />
          )}
        </Section>
      ) : (
        <p className="text-muted-foreground text-xs">
          Las tarjetas siguen su resumen: cargá el saldo de cada resumen
          editando la deuda.
        </p>
      )}

      {eventDialog && (
        <DebtEventDialog
          key={eventDialog.event?.id ?? eventDialog.kind}
          mode={eventDialog.event ? "edit" : "create"}
          linkedTo={eventDialog.event?.cash_holding_id ?? null}
          tookFrom={
            eventDialog.event?.takes_cash
              ? eventDialog.event.cash_holding_id
              : null
          }
          initial={
            eventDialog.initial ??
            eventFields(
              eventDialog.kind,
              eventDialog.event,
              today,
              eventDialog.prefill,
            )
          }
          initialError={eventDialog.initialError}
          unit={unitOf(debt)}
          cash={linksCash ? cash : null}
          cashNote="Esta deuda no se paga desde una cuenta: está en UVA o en una cripto."
          check={check(eventDialog)}
          returnFocusTo={() => card.focusHeading()}
          onClose={() => setEventDialog(null)}
          onSubmit={(fields) => submitEvent(eventDialog, fields)}
        />
      )}
      {debtDialog && (
        <DebtDialog
          mode="edit"
          initial={debtDialog.initial ?? debtFields(debt)}
          initialError={debtDialog.initialError}
          instruments={instruments}
          returnFocusTo={() => card.focusHeading()}
          onClose={() => setDebtDialog(null)}
          check={checkDebt}
          onSubmit={(fields) => submitDebt(debtDialog, fields)}
        />
      )}
      {collateralDialog && (
        <DebtCollateralDialog
          options={options}
          initial={collateralDialog.initial ?? shown.collateral}
          initialError={collateralDialog.initialError}
          returnFocusTo={() => card.focusHeading()}
          onClose={() => setCollateralDialog(null)}
          onSubmit={(ids) =>
            card.dialogAction(
              { kind: "collateral", ids },
              () => actions.collateral(debt.id, ids),
              COLLATERAL_MESSAGES,
              {
                done: "Guardaste la garantía",
                reopen: (error) =>
                  setCollateralDialog({ initial: ids, initialError: error }),
              },
            )
          }
        />
      )}
      {installmentsDialog && (
        <DebtInstallmentsDialog
          initial={installmentsDialog.initial ?? shown.installments}
          initialError={installmentsDialog.initialError}
          unit={unitOf(debt)}
          returnFocusTo={() => card.focusHeading()}
          onClose={() => setInstallmentsDialog(null)}
          onSubmit={(installments) =>
            card.dialogAction(
              { kind: "installments", installments },
              () => actions.installments(debt.id, installments),
              COLLATERAL_MESSAGES,
              {
                done: "Guardaste el plan de cuotas",
                reopen: (error) =>
                  setInstallmentsDialog({
                    initial: installments,
                    initialError: error,
                  }),
              },
            )
          }
        />
      )}
      {disbursementDialog && (
        <DebtDisbursementDialog
          options={disbursement.options}
          initial={
            disbursementDialog.initial === undefined
              ? shown.disbursement
              : disbursementDialog.initial
          }
          initialError={disbursementDialog.initialError}
          returnFocusTo={() => card.focusHeading()}
          onClose={() => setDisbursementDialog(null)}
          onSubmit={(operationId) =>
            card.dialogAction(
              { kind: "disbursement", operationId },
              () => actions.disbursement!(debt.id, operationId),
              COLLATERAL_MESSAGES,
              {
                done: "Guardaste el desembolso",
                reopen: (error) =>
                  setDisbursementDialog({
                    initial: operationId,
                    initialError: error,
                  }),
              },
            )
          }
        />
      )}
      {deletingEvent && (
        <ConfirmDialog
          title={`¿Borrar el ${DEBT_EVENT_LABELS[deletingEvent.kind].toLowerCase()} del ${formatDate(deletingEvent.date)}?`}
          description={
            deletingEvent.takes_cash
              ? "El efectivo que salió de la cuenta vuelve a ella. El saldo se recalcula."
              : "El saldo se recalcula sin él."
          }
          confirmLabel="Borrar"
          returnFocusTo={() => card.focusHeading()}
          onClose={() => setDeletingEvent(null)}
          onConfirm={() =>
            card.rowAction(
              { kind: "delete_event", id: deletingEvent.id },
              () => warned(actions.events.delete(deletingEvent.id)),
              (result) =>
                result === "rejected"
                  ? { kind: "alert", text: FAILED }
                  : result.ok
                    ? { kind: "done" }
                    : { kind: "alert", text: DEBT_EVENT_MESSAGES[result.code] },
              {
                done: "Borraste el movimiento",
                rowId: deletingEvent.id,
                actionId: "delete",
              },
            )
          }
        />
      )}
      {deletingDebt && (
        <ConfirmDialog
          title={`¿Borrar ${debt.label}?`}
          description={DEBT_DELETE_DESCRIPTION}
          confirmLabel="Borrar"
          returnFocusTo={() => card.focusHeading()}
          onClose={() => setDeletingDebt(false)}
          onConfirm={deleteDebt}
        />
      )}
    </div>
  );
}
