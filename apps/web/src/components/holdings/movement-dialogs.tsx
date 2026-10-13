"use client";

import { type MovementKind, takesMovements, takesUnits } from "@plant/core";
import { ArrowLeftRight, Pencil, Trash2 } from "lucide-react";
import { type ComponentProps, type ReactNode, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { dialogAnswer } from "@/components/portfolio-setup/answers";
import type { ListChange } from "@/components/portfolio-setup/list-change";
import type {
  Retry,
  SetupCardState,
} from "@/components/portfolio-setup/setup-card";
import type { ConfirmSpec } from "@/components/ui/confirm-dialog";
import type { RowAction } from "@/components/ui/data-table";
import { PendingButton } from "@/components/ui/pending-button";
import { formatDate } from "@/lib/format/date";
import { inSentence } from "@/lib/format/text";
import {
  currencyOf,
  holdingInSentence,
  holdingPlace,
} from "@/lib/holdings/holding-name";
import {
  HOLDING_DELETE_MESSAGES,
  lineLabel,
  MOVEMENT_DELETE_MESSAGES,
  MOVEMENT_MESSAGES,
} from "@/lib/holdings/messages";
import type { HoldingDeleteResult } from "@/lib/holdings/delete-result";
import type {
  MovementLine,
  MovementsInput,
  OperationParts,
} from "@/lib/holdings/movements-input";
import type { HoldingRow, InstrumentRow } from "@/lib/holdings/read";
import type { MovementActions } from "@/lib/holdings/write-actions";
import type {
  PortfolioRow,
  SourceConnectionRow,
} from "@/lib/portfolio-setup/read";

import { MovementDialog } from "./movement-dialog";
import {
  type MovementFields,
  newMovementFields,
  operationFields,
  toOperationInput,
} from "./movement-fields";

// A new operation, from a page's button or for one holding, or an edit of
// one.
type MovementDialogState =
  | ({ kind: "create"; row: HoldingRow | null } & Retry<MovementFields>)
  | ({ kind: "edit"; operation: OperationParts } & Retry<MovementFields>);

// What a new operation starts on besides the holding it is opened from: its
// kind, and an instrument, account and portfolio chosen by the page.
type OperationPreset = {
  kind?: MovementKind;
  instrument?: string;
  accountId?: string;
  portfolioId?: string;
};

// A new movement of one instrument, in the account and portfolio it is held
// in when it is held in only one.
export function instrumentPreset(
  symbol: string,
  held: readonly Pick<HoldingRow, "account" | "portfolio">[],
): OperationPreset {
  const accountIds = new Set(held.map((row) => row.account.id));
  const portfolioIds = new Set(held.map((row) => row.portfolio.id));
  return {
    instrument: symbol,
    ...(accountIds.size === 1 && { accountId: [...accountIds][0] }),
    ...(portfolioIds.size === 1 && { portfolioId: [...portfolioIds][0] }),
  };
}

// The part of a page's movements the dialogs read.
type DialogMovement = {
  input: Pick<MovementsInput, "positions" | "transferCost" | "quoteOn">;
  actions: MovementActions;
};

// The movement dialog and the deletes that ask first, for a page that lists
// holdings: the page passes its movements where it has them.
export function useMovementDialogs({
  card,
  active,
  accounts,
  portfolios,
  instruments,
  today,
  names,
  confirm,
  pending,
}: {
  card: Pick<
    SetupCardState<ListChange<HoldingRow> | null>,
    "focusHeading" | "rowAction" | "dialogAction"
  >;
  // The holdings the page shows, so a write marks the ones it touches.
  active: readonly HoldingRow[];
  accounts: SourceConnectionRow[];
  portfolios: PortfolioRow[];
  instruments: InstrumentRow[];
  today: string;
  names: ReadonlyMap<string, string>;
  confirm: (spec: ConfirmSpec) => void;
  pending: boolean;
}) {
  const router = useRouter();
  const [state, setState] = useState<MovementDialogState | null>(null);
  const types = new Map(instruments.map((each) => [each.symbol, each.type]));
  const typeOf = (symbol: string) => types.get(symbol) ?? null;
  const named = (row: HoldingRow) => holdingInSentence(row, names);

  function noAccount() {
    toast.error("Primero agregá una cuenta en Cuentas.", {
      action: {
        label: "Ir a Cuentas",
        onClick: () => router.push("/accounts"),
      },
    });
  }

  function openMovementDialog(next: MovementDialogState) {
    if (pending) return;
    if (next.kind === "create" && accounts.length === 0) {
      noAccount();
      return;
    }
    setState(next);
  }

  // A new operation's fields: today, in the holding's account, instrument and
  // portfolio when opened from one (its amount as an opening balance), else
  // the preset's or the first account's, and that account's portfolio. A
  // holding without movements starts on an opening balance, so one opened
  // from a holding needs the page's positions.
  function newOperationFields(
    row: HoldingRow | null,
    preset: OperationPreset,
    positions?: MovementsInput["positions"],
  ): MovementFields {
    const symbol =
      preset.instrument ??
      (row?.holding.asset_class === "instrument"
        ? row.holding.instrument_symbol
        : (instruments[0]?.symbol ?? ""));
    const accountId = preset.accountId ?? row?.account.id ?? accounts[0]?.id;
    const account = accounts.find((each) => each.id === accountId);
    const hasMovements = row ? (positions?.has(row.id) ?? false) : true;
    const kind = preset.kind ?? (hasMovements ? "purchase" : "opening_balance");
    const size =
      kind === "opening_balance" && row ? row.holding.amount : undefined;
    return newMovementFields({
      kind,
      accountId: accountId ?? "",
      instrument: symbol,
      currency: currencyOf(instruments, symbol),
      date: today,
      portfolioId:
        preset.portfolioId ??
        row?.portfolio.id ??
        account?.portfolio.id ??
        portfolios[0]?.id ??
        "",
      ...(size !== undefined && { size }),
    });
  }

  function submitMovement(
    shown: MovementDialogState,
    actions: MovementActions,
    fields: MovementFields,
  ): boolean {
    const input = toOperationInput(fields, typeOf(fields.instrument));
    const instrument =
      instruments.find((each) => each.symbol === fields.instrument)?.name ??
      fields.instrument;
    // The holdings it touches show as saving until they are read again.
    const touched = active.find(
      (row) =>
        row.account.id === fields.accountId &&
        row.holding.asset_class === "instrument" &&
        row.holding.instrument_symbol === fields.instrument &&
        fields.parts.some((part) => part.portfolioId === row.portfolio.id),
    );
    return card.dialogAction(
      touched ? { kind: "update", row: touched } : null,
      () =>
        shown.kind === "edit"
          ? actions.update(
              shown.operation.parts[0]!.movement.operation_id,
              input,
            )
          : actions.create(input),
      MOVEMENT_MESSAGES,
      {
        done:
          shown.kind === "edit"
            ? `Guardaste el movimiento de ${instrument}`
            : `Agregaste un movimiento de ${instrument}`,
        reopen: (error) =>
          setState({ ...shown, initial: fields, initialError: error }),
      },
    );
  }

  // A transfer the dialog offers: from the instrument holding it was opened
  // from, or the portfolio an edited transfer's units leave.
  function transferOf(
    shown: MovementDialogState,
    input: DialogMovement["input"],
  ): ComponentProps<typeof MovementDialog>["transfer"] {
    const { transferCost } = input;
    if (!transferCost) return undefined;
    const from =
      shown.kind === "edit"
        ? shown.operation.parts.find(({ movement }) => takesUnits(movement))
            ?.portfolioId
        : shown.row?.holding.asset_class === "instrument"
          ? shown.row.portfolio.id
          : undefined;
    if (
      from === undefined ||
      (shown.kind === "edit" &&
        shown.operation.parts[0]!.movement.kind !== "transfer")
    ) {
      return undefined;
    }
    return {
      from,
      suggestedCost: (fields) =>
        transferCost({
          input: toOperationInput(fields, typeOf(fields.instrument)),
          operationId:
            shown.kind === "edit"
              ? shown.operation.parts[0]!.movement.operation_id
              : null,
        }),
    };
  }

  // Yields the dialog offers: into the holding it was opened from, once that
  // holding has movements, or into the one portfolio an edited operation is
  // in.
  function yieldsOf(
    shown: MovementDialogState,
    input: DialogMovement["input"],
  ): ComponentProps<typeof MovementDialog>["yields"] {
    const { quoteOn } = input;
    if (!quoteOn) return undefined;
    const portfolio =
      shown.kind === "edit"
        ? shown.operation.parts.length === 1
          ? shown.operation.parts[0]!.portfolioId
          : undefined
        : shown.row && input.positions.has(shown.row.id)
          ? shown.row.portfolio.id
          : undefined;
    return portfolio === undefined ? undefined : { portfolio, quoteOn };
  }

  // A movement as its actions name it: "compra del 01/09/2026".
  const movementName = (line: MovementLine) =>
    `${inSentence(lineLabel(line))} del ${formatDate(line.movement.date)}`;

  // The account and instrument a dialog keeps, by name.
  const fixedOf = (accountId: string, symbol: string) => ({
    account:
      accounts.find((each) => each.id === accountId)?.institution ??
      active.find((row) => row.account.id === accountId)?.account.institution ??
      "",
    instrument:
      instruments.find((each) => each.symbol === symbol)?.name ?? symbol,
  });

  // Editar and Borrar on each movement line; Borrar asks first and needs the
  // line's holding, which a delete may have taken off the page. A list of
  // several holdings' lines names each by where it is, so two lines of one
  // day stay apart.
  function movementLineActions(
    movement: DialogMovement,
    rowOf: (line: MovementLine) => HoldingRow | undefined,
  ): RowAction<MovementLine>[] {
    const lineName = (line: MovementLine) => {
      const row = rowOf(line);
      return row
        ? `${movementName(line)} en ${holdingPlace(row)}`
        : movementName(line);
    };
    const remove = movement.actions.delete;
    return [
      {
        id: "edit",
        icon: Pencil,
        tooltip: "Editar",
        label: (line) => `Editar ${lineName(line)}`,
        // A line whose holding a delete just took off the page keeps neither
        // action until the page reads it again.
        hidden: (line) => rowOf(line) === undefined,
        onClick: (line) =>
          openMovementDialog({ kind: "edit", operation: line.operation }),
      },
      ...(remove
        ? [
            {
              id: "delete",
              icon: Trash2,
              tooltip: "Borrar",
              label: (line: MovementLine) => `Borrar ${lineName(line)}`,
              hidden: (line: MovementLine) => rowOf(line) === undefined,
              onClick: (line: MovementLine) => {
                const row = rowOf(line);
                if (row) confirmDeleteMovement(line, row, remove);
              },
            },
          ]
        : []),
    ];
  }

  function confirmDeleteMovement(
    line: MovementLine,
    row: HoldingRow,
    remove: NonNullable<MovementActions["delete"]>,
  ) {
    const parts = line.operation.parts.length;
    confirm({
      title: `¿Borrar ${movementName(line)} en ${holdingPlace(row)}?`,
      description:
        line.movement.kind === "transfer"
          ? "Es un traspaso: se borra en las dos carteras. No se puede deshacer."
          : parts > 1
            ? `Es parte de una operación repartida en ${parts} carteras: se borra en todas. No se puede deshacer.`
            : "No se puede deshacer.",
      run: () =>
        card.rowAction(
          { kind: "update", row },
          () => remove(line.movement.operation_id),
          (result) => dialogAnswer(result, MOVEMENT_DELETE_MESSAGES),
          {
            done: `Borraste ${movementName(line)} de ${named(row)}`,
            rowId: line.movement.id,
            actionId: "delete",
          },
        ),
    });
  }

  // Borrar on a list of holdings: it asks first, and takes the holding's
  // movements with it.
  function holdingDeleteAction<T>(
    remove: (id: string) => Promise<HoldingDeleteResult>,
    rowOf: (row: T) => HoldingRow | null,
  ): RowAction<T> {
    return {
      id: "delete",
      icon: Trash2,
      tooltip: "Borrar",
      label: (row) => {
        const holding = rowOf(row);
        return holding ? `Borrar ${named(holding)}` : "Borrar";
      },
      hidden: (row) => rowOf(row) === null,
      onClick: (row) => {
        const holding = rowOf(row);
        if (!holding) return;
        confirm({
          title: `¿Borrar ${named(holding)}?`,
          description: takesMovements(holding.holding)
            ? "Se borran también sus movimientos. No se puede deshacer."
            : "No se puede deshacer.",
          run: () =>
            card.rowAction(
              { kind: "delete", id: holding.id },
              () => remove(holding.id),
              (result) => dialogAnswer(result, HOLDING_DELETE_MESSAGES),
              {
                done: `Borraste ${named(holding)}`,
                rowId: holding.id,
                actionId: "delete",
              },
            ),
        });
      },
    };
  }

  // "Agregar movimiento" for a page or one instrument.
  function addMovementButton(preset: OperationPreset = {}): ReactNode {
    return (
      <PendingButton
        size="sm"
        variant="outline"
        pending={pending}
        onClick={() =>
          openMovementDialog({
            kind: "create",
            row: null,
            initial: newOperationFields(null, preset),
          })
        }
      >
        <ArrowLeftRight />
        Agregar movimiento
      </PendingButton>
    );
  }

  function render(movement: DialogMovement): ReactNode {
    if (!state) return null;
    return (
      <MovementDialog
        transfer={transferOf(state, movement.input)}
        yields={yieldsOf(state, movement.input)}
        mode={state.kind}
        accounts={accounts}
        portfolios={portfolios}
        instruments={instruments}
        fixed={
          state.kind === "edit"
            ? fixedOf(state.operation.accountId, state.operation.instrument)
            : state.row?.holding.asset_class === "instrument"
              ? fixedOf(
                  state.row.account.id,
                  state.row.holding.instrument_symbol,
                )
              : undefined
        }
        initial={
          state.initial ??
          (state.kind === "edit"
            ? operationFields(state.operation.parts, {
                accountId: state.operation.accountId,
                instrument: state.operation.instrument,
                type: typeOf(state.operation.instrument),
              })
            : newOperationFields(state.row, {}, movement.input.positions))
        }
        initialError={state.initialError}
        today={today}
        returnFocusTo={card.focusHeading}
        onClose={() => setState(null)}
        onSubmit={(fields) => submitMovement(state, movement.actions, fields)}
      />
    );
  }

  return {
    noAccount,
    openMovementDialog,
    newOperationFields,
    movementLineActions,
    holdingDeleteAction,
    addMovementButton,
    render,
  };
}
