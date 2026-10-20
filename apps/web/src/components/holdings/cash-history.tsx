"use client";

import { type CashMovementKind } from "@plant/core";
import {
  type Currency,
  exactOf,
  minus,
  negated,
  plus,
  stored,
} from "@plant/shared";
import type { ColumnDef } from "@tanstack/react-table";
import { FileSpreadsheet, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { usePreload } from "@/hooks/use-preload";
import { temporaryId } from "@/components/portfolio-setup/list-change";
import { useOptimisticWrites } from "@/components/portfolio-setup/optimistic-writes";
import {
  SetupCard,
  useSetupCard,
} from "@/components/portfolio-setup/setup-card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  actionsColumn,
  DataTable,
  TruncatedText,
} from "@/components/ui/data-table";
import { PageButton } from "@/components/ui/page-button";
import {
  CASH_CURRENCIES,
  type CashResult,
  type StatementResult,
  type StatementSummary,
} from "@/lib/cash/input";
import {
  CASH_KIND_LABELS,
  CASH_MESSAGES,
  CURRENCY_IN_TEXT,
} from "@/lib/cash/messages";
import { amountInput, formatAmount } from "@/lib/format/amount";
import { formatDate } from "@/lib/format/date";
import { CURRENCY_LABELS } from "@/lib/holdings/messages";
import { FAILED } from "@/lib/portfolio-setup/messages";

import type { CashEntryFields } from "./cash-entry-dialog";
import {
  CashEntryDialog,
  preloadCashDialogs,
  StatementDialog,
} from "./lazy-dialogs";
import { NUMBER_CELL } from "./sum-text";

// One movement of the account's cash as the page lists it: what moved it
// (the operation a leg settles, or the note) and, while its write runs,
// unsaved.
export type CashLine = {
  id: string;
  kind: CashMovementKind;
  date: string;
  amount: string;
  detail: string | null;
  unsaved?: true;
};

// The account's cash in one currency: what it holds today and its history,
// newest first.
export type CashSideView = {
  currency: Currency;
  balance: string;
  lines: CashLine[];
};

export type CashActions = {
  write: (input: unknown) => Promise<CashResult>;
  importStatement: (input: unknown) => Promise<StatementResult>;
};

type Change =
  // An opening balance that `replaces` the one before takes its place.
  | { kind: "add"; currency: Currency; line: CashLine; replaces?: CashLine }
  | { kind: "delete"; currency: Currency; id: string };

function apply(sides: CashSideView[], change: Change): CashSideView[] {
  const has = sides.some((side) => side.currency === change.currency);
  const all = has
    ? sides
    : [...sides, { currency: change.currency, balance: "0", lines: [] }];
  return all.map((side) => {
    if (side.currency !== change.currency) return side;
    if (change.kind === "add") {
      const { line, replaces } = change;
      // A first opening balance starts the cash from 0.
      const base =
        line.kind === "opening_balance" && !replaces
          ? exactOf("0")
          : minus(exactOf(side.balance), exactOf(replaces?.amount ?? "0"));
      return {
        ...side,
        balance: stored(plus(base, exactOf(line.amount))),
        lines: [line, ...side.lines.filter((each) => each !== replaces)].sort(
          (a, b) => b.date.localeCompare(a.date),
        ),
      };
    }
    const gone = side.lines.find((line) => line.id === change.id);
    return {
      ...side,
      balance: gone
        ? stored(minus(exactOf(side.balance), exactOf(gone.amount)))
        : side.balance,
      lines: side.lines.filter((line) => line.id !== change.id),
    };
  });
}

const ADDED = {
  opening_balance: "Cargaste el saldo inicial",
  deposit: "Registraste el depósito",
  withdrawal: "Registraste la extracción",
} as const;

// An account's cash with its history, in pesos and dollars: its opening
// balance, deposits and withdrawals typed by hand, and what a broker's export
// of the account's movements brings in. Those are the only money put in or
// taken out once it has a history; its trades only move money between the
// cash and the instruments.
export function CashHistory({
  accountId,
  sides,
  today,
  actions,
}: {
  accountId: string;
  sides: CashSideView[];
  today: string;
  actions: CashActions;
}) {
  const { shown, pending, run } = useOptimisticWrites(sides, apply);
  const card = useSetupCard({ run, pending });
  usePreload(preloadCashDialogs);
  const [entry, setEntry] = useState<{
    initial: CashEntryFields;
    initialError?: string;
    // An opening balance, and the one it replaces.
    opening?: { replaces: CashLine | null };
  } | null>(null);
  const [importing, setImporting] = useState(false);
  const [deleting, setDeleting] = useState<{
    currency: Currency;
    line: CashLine;
  } | null>(null);
  const openingOf = (currency: Currency) =>
    shown
      .find((side) => side.currency === currency)
      ?.lines.find((line) => line.kind === "opening_balance") ?? null;

  function openEntry() {
    setEntry({
      initial: {
        kind: "deposit",
        currency: CASH_CURRENCIES[0]!,
        date: today,
        amount: "",
        note: "",
      },
    });
  }

  function openOpening(currency: Currency) {
    const replaces = openingOf(currency);
    setEntry({
      initial: {
        kind: "opening_balance",
        currency,
        date: replaces?.date ?? today,
        amount: replaces ? amountInput(replaces.amount) : "",
        note: "",
      },
      opening: { replaces },
    });
  }

  function submit(
    fields: CashEntryFields,
    amount: string,
    replaces: CashLine | null = null,
  ): boolean {
    const signed =
      fields.kind === "withdrawal" ? stored(negated(exactOf(amount))) : amount;
    return card.dialogAction(
      {
        kind: "add",
        currency: fields.currency,
        line: {
          id: temporaryId(),
          kind: fields.kind,
          date: fields.date,
          amount: signed,
          detail: fields.note.trim() || null,
          unsaved: true,
        },
        ...(replaces && { replaces }),
      },
      () =>
        actions.write({
          accountId,
          currency: fields.currency,
          inserts: [
            {
              kind: fields.kind,
              date: fields.date,
              amount,
              note: fields.note.trim() || null,
            },
          ],
          deletes: replaces ? [replaces.id] : [],
        }),
      { ...CASH_MESSAGES, failed: FAILED },
      {
        done: replaces ? "Cambiaste el saldo inicial" : ADDED[fields.kind],
        reopen: (error) =>
          setEntry({
            initial: fields,
            initialError: error,
            ...(fields.kind === "opening_balance" && {
              opening: { replaces },
            }),
          }),
      },
    );
  }

  const columns = (currency: Currency): ColumnDef<CashLine>[] => [
    {
      id: "date",
      header: "Fecha",
      size: 104,
      cell: ({ row: { original } }) => formatDate(original.date),
    },
    {
      id: "kind",
      header: "Movimiento",
      cell: ({ row: { original } }) => (
        <>
          <TruncatedText
            className="font-medium"
            text={CASH_KIND_LABELS[original.kind]}
          />
          {original.detail && (
            <TruncatedText
              className="text-muted-foreground text-xs"
              text={original.detail}
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
      cell: ({ row: { original } }) => formatAmount(original.amount, currency),
    },
    actionsColumn<CashLine>(
      [
        {
          id: "delete",
          icon: Trash2,
          tooltip: "Borrar",
          label: (line) =>
            `Borrar ${CASH_KIND_LABELS[line.kind].toLowerCase()} del ${formatDate(line.date)}`,
          // An operation's cash goes with it.
          hidden: (line) => line.kind === "settlement" || line.unsaved === true,
          onClick: (line) => !pending && setDeleting({ currency, line }),
        },
      ],
      { pending },
    ),
  ];

  return (
    <SetupCard
      heading={card.heading}
      pending={pending}
      title="Efectivo"
      page
      description="Con su historial, lo que pusiste o sacaste son los depósitos y las extracciones; las compras y ventas mueven plata dentro de la cuenta."
      addLabel="Registrar movimiento"
      onAdd={openEntry}
      secondary={
        <PageButton disabled={pending} onClick={() => setImporting(true)}>
          <FileSpreadsheet />
          Importar movimientos
        </PageButton>
      }
    >
      <div className="grid gap-2 sm:grid-cols-2">
        {CASH_CURRENCIES.map((currency) => {
          const opening = openingOf(currency);
          return (
            <div
              key={currency}
              className="bg-card flex items-center justify-between gap-3 rounded-lg border px-3 py-2"
            >
              <div className="grid gap-0.5">
                <p className="text-xs font-medium">
                  {`Saldo inicial en ${CURRENCY_IN_TEXT[currency]}`}
                </p>
                <p className="text-muted-foreground text-xs">
                  {opening
                    ? `${formatAmount(opening.amount, currency)} al ${formatDate(opening.date)}`
                    : "Sin cargar: lo que había en la cuenta cuando empezás a seguirla"}
                </p>
              </div>
              <PageButton
                variant={opening ? "outline" : "default"}
                disabled={pending}
                onClick={() => openOpening(currency)}
              >
                {opening ? "Cambiar" : "Cargar"}
              </PageButton>
            </div>
          );
        })}
      </div>
      {shown.length === 0 ? (
        <p className="text-muted-foreground text-xs">
          Todavía no tiene movimientos: cargá el saldo inicial o importá los de
          la cuenta.
        </p>
      ) : (
        shown.map((side) => (
          <div key={side.currency} className="grid gap-2">
            <p className="text-xs font-medium">
              {`${CURRENCY_LABELS[side.currency]} · hoy ${formatAmount(side.balance, side.currency)}`}
            </p>
            <DataTable
              caption={`Movimientos del efectivo en ${CURRENCY_IN_TEXT[side.currency]}`}
              columns={columns(side.currency)}
              data={side.lines}
            />
          </div>
        ))
      )}
      {entry && (
        <CashEntryDialog
          initial={entry.initial}
          initialError={entry.initialError}
          today={today}
          opening={entry.opening !== undefined}
          returnFocusTo={() => card.focusHeading()}
          onClose={() => setEntry(null)}
          onSubmit={(fields, amount) =>
            submit(fields, amount, entry.opening?.replaces ?? null)
          }
        />
      )}
      {importing && (
        <StatementDialog
          load={(file, confirm) =>
            actions.importStatement({ accountId, ...file, confirm })
          }
          returnFocusTo={() => card.focusHeading()}
          onClose={() => setImporting(false)}
          onDone={(summary: StatementSummary) =>
            toast.success(
              `Importaste los movimientos${summary.created > 0 ? ` y ${summary.created} operaciones` : ""}`,
            )
          }
        />
      )}
      {deleting && (
        <ConfirmDialog
          title={`¿Borrar el ${CASH_KIND_LABELS[deleting.line.kind].toLowerCase()} del ${formatDate(deleting.line.date)}?`}
          description="El efectivo de hoy y los cierres se recalculan sin él."
          confirmLabel="Borrar"
          returnFocusTo={() => card.focusHeading()}
          onClose={() => setDeleting(null)}
          onConfirm={() =>
            card.rowAction(
              {
                kind: "delete",
                currency: deleting.currency,
                id: deleting.line.id,
              },
              () =>
                actions.write({
                  accountId,
                  currency: deleting.currency,
                  inserts: [],
                  deletes: [deleting.line.id],
                }),
              (result) =>
                result === "rejected"
                  ? { kind: "alert", text: FAILED }
                  : result.ok
                    ? { kind: "done" }
                    : { kind: "alert", text: CASH_MESSAGES[result.code] },
              {
                done: "Borraste el movimiento",
                rowId: deleting.line.id,
                actionId: "delete",
              },
            )
          }
        />
      )}
    </SetupCard>
  );
}
