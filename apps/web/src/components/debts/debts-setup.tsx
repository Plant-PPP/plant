"use client";

import {
  type Denominator,
  isOwed,
  type LiabilitiesValue,
  type Liability,
  type LiabilityOnDate,
} from "@plant/core";
import type { ColumnDef } from "@tanstack/react-table";
import { Pencil, Trash2 } from "lucide-react";
import { useId, useState } from "react";

import { useAssetsUrl } from "@/components/holdings/assets-url";
import { UnitSelect } from "@/components/holdings/filter-select";
import {
  CALCULATING,
  MissingFigure,
  NO_QUOTE,
  NUMBER_CELL,
  VALUE_CELL,
} from "@/components/holdings/sum-text";
import {
  dialogAnswer,
  type WriteMessages,
} from "@/components/portfolio-setup/answers";
import {
  applyChange,
  type ListChange,
  temporaryId,
} from "@/components/portfolio-setup/list-change";
import { useOptimisticWrites } from "@/components/portfolio-setup/optimistic-writes";
import {
  ActiveList,
  type Retry,
  SetupCard,
  useSetupCard,
} from "@/components/portfolio-setup/setup-card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { TruncatedText, actionsColumn } from "@/components/ui/data-table";
import {
  formatAmount,
  formatFraction,
  formatQuantity,
} from "@/lib/format/amount";
import { formatDate } from "@/lib/format/date";
import type { InstrumentRow } from "@/lib/holdings/read";
import { UNIT_LABELS } from "@/lib/holdings/messages";
import { FAILED, WRITE_MESSAGES } from "@/lib/portfolio-setup/messages";
import type { ListView } from "@/lib/portfolio-setup/read";
import type { WriteResult } from "@/lib/portfolio-setup/write-result";
import type { KeysetParams } from "@/lib/supabase/keyset";

import { DEBT_INVALID, DebtDialog } from "./debt-dialog";
import {
  type DebtFields,
  debtFields,
  LIABILITY_KIND_LABELS,
  toLiabilityInput,
  unitOf,
} from "./debt-fields";
import { StatGrid, StatTile } from "@/components/ui/stat-tile";

export type DebtActions = {
  create: (input: unknown) => Promise<WriteResult>;
  update: (id: string, input: unknown) => Promise<WriteResult>;
  delete: (id: string) => Promise<WriteResult>;
};

// A debt's guard refusal reads as invalid, like a field the form missed.
const MESSAGES: WriteMessages = {
  ...WRITE_MESSAGES.holdings,
  duplicate: FAILED,
  invalid: DEBT_INVALID,
  not_found: "Esa deuda cambió hace un momento. Ya actualizamos la lista.",
  failed: FAILED,
};

type Row = Liability & { unsaved?: true };

type DialogState =
  | ({ kind: "create" } & Retry<DebtFields>)
  | ({ kind: "edit"; row: Liability } & Retry<DebtFields>);

// A debt's balance in its own unit: "38.500 UVA", "US$ 3.000,00".
function owed(debt: Liability, amount: string): string {
  return debt.currency !== null && !debt.uva
    ? formatAmount(amount, debt.currency)
    : `${formatQuantity(amount)} ${unitOf(debt)}`;
}

// What a user owes, each debt in its own unit and in the page's, with the
// total and the installments due each month.
export function DebtsSetup({
  debts,
  owed: owedToday,
  complete,
  valued,
  unit,
  referenceUnit,
  params,
  instruments,
  actions,
}: {
  debts: ListView<Liability>;
  // Each debt's balance and rate today, in its own unit.
  owed: readonly LiabilityOnDate[];
  // Whether every debt's history was read and computed in full.
  complete: boolean;
  // Each debt's balance and the total in the page's unit.
  valued: LiabilitiesValue;
  unit: Denominator;
  referenceUnit: Denominator;
  params: KeysetParams;
  instruments: InstrumentRow[];
  actions: DebtActions;
}) {
  const { shown, pending, run } = useOptimisticWrites(
    debts,
    (state, change: ListChange<Row>) => applyChange<Row>(state, change),
  );
  const card = useSetupCard({ run, pending });
  const url = useAssetsUrl(params);
  const id = useId();
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [deleting, setDeleting] = useState<Liability | null>(null);
  const values = new Map(valued.items.map((item) => [item.id, item.value]));
  const computed = new Map(owedToday.map((debt) => [debt.id, debt]));
  // A row being written has no figures today until the page reloads them.
  const todayOf = (debt: Row) =>
    debt.unsaved ? undefined : computed.get(debt.id);
  // A paid-off debt stays listed at 0 but no longer counts as owed; an edit
  // keeps counting as it was.
  const live = shown.active.filter((debt) => {
    const figure = computed.get(debt.id);
    return figure === undefined || isOwed(figure);
  });

  function submit(state: DialogState, fields: DebtFields): boolean {
    const input = toLiabilityInput(fields);
    const row: Row = {
      ...(input as Omit<Liability, "id">),
      id: state.kind === "edit" ? state.row.id : temporaryId(),
    };
    return card.dialogAction(
      state.kind === "edit" ? { kind: "update", row } : { kind: "create", row },
      () =>
        state.kind === "edit"
          ? actions.update(state.row.id, input)
          : actions.create(input),
      MESSAGES,
      {
        done: `${state.kind === "edit" ? "Guardaste" : "Agregaste"} ${fields.label.trim()}`,
        reopen: (error) =>
          setDialog({ ...state, initial: fields, initialError: error }),
      },
    );
  }

  const columns: ColumnDef<Row>[] = [
    {
      id: "debt",
      header: "Deuda",
      cell: ({ row: { original: debt } }) => (
        <>
          <TruncatedText className="font-medium" text={debt.label} />
          <TruncatedText
            className="text-muted-foreground text-xs"
            text={[LIABILITY_KIND_LABELS[debt.kind], debt.lender]
              .filter(Boolean)
              .join(" · ")}
          />
          {/* The balance's own column shows only on a wide table. */}
          <span className="text-muted-foreground block text-xs tabular-nums @2xl:hidden">
            {todayOf(debt) ? owed(debt, todayOf(debt)!.balance) : CALCULATING}
          </span>
        </>
      ),
    },
    {
      id: "balance",
      header: "Saldo",
      size: 152,
      meta: { className: `hidden @2xl:table-cell ${NUMBER_CELL}` },
      cell: ({ row: { original: debt } }) => {
        const today = todayOf(debt);
        return today ? owed(debt, today.balance) : CALCULATING;
      },
    },
    {
      id: "installment",
      header: "Cuota",
      size: 152,
      meta: { className: `hidden @3xl:table-cell ${NUMBER_CELL}` },
      cell: ({ row: { original: debt } }) =>
        debt.installment ? (
          <span>
            {owed(debt, debt.installment)}
            {debt.installments_left && (
              <span className="text-muted-foreground block text-xs">
                {`${debt.installments_left === 1 ? "Queda" : "Quedan"} ${debt.installments_left}`}
              </span>
            )}
          </span>
        ) : (
          <MissingFigure text="Sin cuota" />
        ),
    },
    {
      id: "rate",
      header: "Tasa",
      size: 88,
      meta: { className: `hidden @4xl:table-cell ${NUMBER_CELL}` },
      cell: ({ row: { original: debt } }) => {
        const today = todayOf(debt);
        if (!today) return CALCULATING;
        return today.annual_rate === null ? (
          <MissingFigure text="Sin tasa" />
        ) : (
          formatFraction(today.annual_rate)
        );
      },
    },
    {
      id: "due",
      header: "Vence",
      size: 112,
      meta: { className: "hidden @4xl:table-cell text-muted-foreground" },
      cell: ({ row: { original: debt } }) =>
        debt.next_due_on ? formatDate(debt.next_due_on) : null,
    },
    {
      id: "value",
      header: UNIT_LABELS[unit],
      meta: { className: VALUE_CELL },
      cell: ({ row: { original: debt } }) => {
        if (debt.unsaved) return CALCULATING;
        const value = values.get(debt.id);
        return value == null ? (
          <MissingFigure text={NO_QUOTE} />
        ) : (
          formatAmount(value, unit)
        );
      },
    },
    actionsColumn<Row>(
      [
        {
          id: "edit",
          icon: Pencil,
          tooltip: "Editar",
          label: (debt) => `Editar ${debt.label}`,
          onClick: (debt) => !pending && setDialog({ kind: "edit", row: debt }),
        },
        {
          id: "delete",
          icon: Trash2,
          tooltip: "Borrar",
          label: (debt) => `Borrar ${debt.label}`,
          onClick: (debt) => !pending && setDeleting(debt),
        },
      ],
      { pending },
    ),
  ];

  const monthly = live.filter((debt) => debt.installment);

  return (
    <div className="grid gap-4">
      <SetupCard
        heading={card.heading}
        pending={pending}
        page
        title="Deudas"
        description="Lo que debés, en su moneda y en la que elijas"
        filters={
          shown.active.length > 0 && (
            <UnitSelect
              id={`${id}-unit`}
              unit={unit}
              referenceUnit={referenceUnit}
              pending={pending}
              onChange={(param) => url.set("unit", param)}
              triggerClassName="w-auto"
            />
          )
        }
        addLabel="Agregar deuda"
        onAdd={() => !pending && setDialog({ kind: "create" })}
      >
        {shown.active.length > 0 && (
          <StatGrid>
            <StatTile
              label="Total"
              note={
                [
                  valued.complete ? null : "Alguna deuda no tiene cotización",
                  complete ? null : "Algún saldo no se pudo calcular completo",
                ]
                  .filter((note) => note !== null)
                  .join(". ") || undefined
              }
            >
              {live.length > 0 &&
              live.every(
                (debt) => !("unsaved" in debt) && values.get(debt.id) == null,
              ) ? (
                <MissingFigure text={NO_QUOTE} />
              ) : (
                <span className={pending ? "opacity-60" : undefined}>
                  {formatAmount(valued.total, unit)}
                </span>
              )}
            </StatTile>
            <StatTile label="Deudas">{live.length}</StatTile>
            <StatTile label="Con cuota" note="Pagás cuota todos los meses">
              {monthly.length}
            </StatTile>
            <StatTile
              label="Próximo vencimiento"
              note={
                live
                  .filter((debt) => debt.next_due_on)
                  .sort((a, b) =>
                    a.next_due_on!.localeCompare(b.next_due_on!),
                  )[0]?.label
              }
            >
              {(() => {
                const next = live
                  .map((debt) => debt.next_due_on)
                  .filter((date): date is string => date !== null)
                  .sort()[0];
                return next ? (
                  formatDate(next)
                ) : (
                  <MissingFigure text="Ninguno" />
                );
              })()}
            </StatTile>
          </StatGrid>
        )}
        <ActiveList
          view={shown}
          title="Deudas"
          emptyText="Todavía no cargaste deudas"
          emptyDescription="Agregá tu primera deuda: un préstamo, una hipoteca, una tarjeta o lo que le debas a alguien."
          truncatedText=""
          columns={columns}
        />
      </SetupCard>
      {dialog && (
        <DebtDialog
          key={dialog.kind === "edit" ? dialog.row.id : "new"}
          mode={dialog.kind}
          initial={
            dialog.initial ??
            debtFields(dialog.kind === "edit" ? dialog.row : null)
          }
          initialError={dialog.initialError}
          instruments={instruments}
          returnFocusTo={card.focusHeading}
          onClose={() => setDialog(null)}
          onSubmit={(fields) => submit(dialog, fields)}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title={`¿Borrar ${deleting.label}?`}
          description="No se puede deshacer."
          confirmLabel="Borrar"
          returnFocusTo={card.focusHeading}
          onClose={() => setDeleting(null)}
          onConfirm={() =>
            card.rowAction(
              { kind: "delete", id: deleting.id },
              () => actions.delete(deleting.id),
              (result) => dialogAnswer(result, MESSAGES),
              {
                done: `Borraste ${deleting.label}`,
                rowId: deleting.id,
                actionId: "delete",
              },
            )
          }
        />
      )}
    </div>
  );
}
