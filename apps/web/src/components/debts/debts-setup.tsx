"use client";

import {
  DENOMINATORS,
  type Denominator,
  type LiabilitiesValue,
  type Liability,
} from "@plant/core";
import type { ColumnDef } from "@tanstack/react-table";
import { Pencil, Trash2 } from "lucide-react";
import { useId, useState } from "react";

import { useAssetsUrl } from "@/components/holdings/assets-url";
import { FilterSelect } from "@/components/holdings/filter-select";
import {
  MissingFigure,
  NO_QUOTE,
  NUMBER_CELL,
  SummaryTile,
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
import { unitParam } from "@/lib/holdings/assets-filter";
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

export type DebtActions = {
  create: (input: unknown) => Promise<WriteResult>;
  update: (id: string, input: unknown) => Promise<WriteResult>;
  delete: (id: string) => Promise<WriteResult>;
};

// Debts have no guard of their own: a write is invalid, lost or failed.
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
  valued,
  unit,
  referenceUnit,
  params,
  instruments,
  actions,
}: {
  debts: ListView<Liability>;
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
        </>
      ),
    },
    {
      id: "balance",
      header: "Saldo",
      size: 152,
      meta: { className: `hidden @2xl:table-cell ${NUMBER_CELL}` },
      cell: ({ row: { original: debt } }) => owed(debt, debt.balance),
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
                {`Quedan ${debt.installments_left}`}
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
      cell: ({ row: { original: debt } }) =>
        debt.annual_rate === null ? (
          <MissingFigure text="Sin tasa" />
        ) : (
          formatFraction(debt.annual_rate)
        ),
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
        if (debt.unsaved) return "Calculando…";
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

  const monthly = shown.active.filter((debt) => debt.installment);

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="grid gap-1">
          <h1 className="text-xl font-semibold">Deudas</h1>
          <p className="text-muted-foreground text-sm">
            Lo que debés, en su moneda y en la que elijas
          </p>
        </div>
        <FilterSelect
          id={`${id}-unit`}
          label="Valuar en"
          value={unit}
          pending={pending}
          options={(Object.keys(DENOMINATORS) as Denominator[]).map(
            (each) => [each, UNIT_LABELS[each]] as const,
          )}
          onChange={(value) => url.set("unit", unitParam(value, referenceUnit))}
        />
      </div>
      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryTile
          label="Total"
          note={
            valued.complete ? undefined : "Alguna deuda no tiene cotización"
          }
        >
          <span className={pending ? "opacity-60" : undefined}>
            {formatAmount(valued.total, unit)}
          </span>
        </SummaryTile>
        <SummaryTile label="Deudas">{shown.active.length}</SummaryTile>
        <SummaryTile label="Con cuota" note="Pagás cuota todos los meses">
          {monthly.length}
        </SummaryTile>
        <SummaryTile
          label="Próximo vencimiento"
          note={
            shown.active
              .filter((debt) => debt.next_due_on)
              .sort((a, b) => a.next_due_on!.localeCompare(b.next_due_on!))[0]
              ?.label
          }
        >
          {(() => {
            const next = shown.active
              .map((debt) => debt.next_due_on)
              .filter((date): date is string => date !== null)
              .sort()[0];
            return next ? formatDate(next) : <MissingFigure text="Ninguno" />;
          })()}
        </SummaryTile>
      </dl>
      <SetupCard
        heading={card.heading}
        pending={pending}
        title="Tus deudas"
        description="Préstamos, hipotecas, tarjetas y lo que le debas a alguien"
        addLabel="Agregar deuda"
        onAdd={() => !pending && setDialog({ kind: "create" })}
      >
        <ActiveList
          view={shown}
          title="Deudas"
          emptyText="Todavía no cargaste deudas."
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
