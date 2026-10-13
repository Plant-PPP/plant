"use client";

import { Archive, ArchiveRestore, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { TruncatedText, actionsColumn } from "@/components/ui/data-table";
import { PAGE_ROW_LIMIT } from "@/lib/portfolio-setup/limits";
import {
  deleteMessages,
  toAssets,
  WRITE_MESSAGES,
} from "@/lib/portfolio-setup/messages";
import type { PortfolioRow, PortfoliosView } from "@/lib/portfolio-setup/read";
import type { WriteResult } from "@/lib/portfolio-setup/write-result";
import { dialogAnswer, rowAnswer } from "./answers";
import { type ListChange, temporaryId } from "./list-change";
import { NameDialog } from "./name-dialog";
import {
  ActiveList,
  ArchivedList,
  type Retry,
  SetupCard,
  useSetupCard,
} from "./setup-card";
import type { SetupRun } from "./setup-actions";

type DialogState =
  | ({ kind: "create" } & Retry<string>)
  | ({ kind: "rename"; row: PortfolioRow } & Retry<string>)
  | ({ kind: "restore"; row: PortfolioRow } & Retry<string>);

const COPY = {
  title: "Carteras",
  description: "Agrupá tus inversiones como quieras",
  addLabel: "Nueva cartera",
  emptyText: "No tenés carteras activas.",
  archivedLabel: "Archivadas",
  noMoreArchived: "No hay más carteras archivadas.",
  firstPageLabel: "Ver las más recientes",
  truncated: `Mostrando las ${PAGE_ROW_LIMIT} más recientes.`,
  createDialog: {
    title: "Nueva cartera",
    description: "Elegí un nombre para la cartera.",
  },
  renameDialog: {
    title: "Renombrar cartera",
    description: "Elegí el nuevo nombre.",
  },
  // For a restore whose name an active portfolio took.
  restoreDialog: {
    title: "Restaurar cartera",
    description:
      "Ya tenés una cartera activa con ese nombre. Elegí otro para restaurarla.",
  },
};

const MESSAGES = WRITE_MESSAGES.portfolios;

export type PortfolioActions = {
  create: (input: unknown) => Promise<WriteResult>;
  rename: (id: unknown, input: unknown) => Promise<WriteResult>;
  archive: (id: unknown) => Promise<WriteResult>;
  restore: (id: unknown, input?: unknown) => Promise<WriteResult>;
  // A page that deletes portfolios no account or holding uses.
  delete?: (id: unknown) => Promise<WriteResult>;
};

const DATA_COLUMNS: ColumnDef<PortfolioRow>[] = [
  {
    id: "name",
    header: "Nombre",
    cell: ({ row }) => <TruncatedText text={row.original.name} />,
  },
];

export function PortfoliosCard({
  view,
  pending,
  run,
  actions,
  usedBy,
}: {
  view: PortfoliosView;
  pending: boolean;
  run: SetupRun;
  actions: PortfolioActions;
  // How the active accounts that use a portfolio are named.
  usedBy: (id: string) => string[];
}) {
  const card = useSetupCard({ run, pending });
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [deleting, setDeleting] = useState<PortfolioRow | null>(null);
  const remove = actions.delete;
  const deleteAction = remove && {
    id: "delete",
    icon: Trash2,
    tooltip: "Borrar",
    label: (row: PortfolioRow) => `Borrar ${row.name}`,
    onClick: (row: PortfolioRow) => !pending && setDeleting(row),
  };

  function deleteRow(
    row: PortfolioRow,
    call: (id: unknown) => Promise<WriteResult>,
  ) {
    card.rowAction(
      { list: "portfolios", change: { kind: "delete", id: row.id } },
      () => call(row.id),
      (result) => dialogAnswer(result, deleteMessages(MESSAGES)),
      { done: `Borraste ${row.name}`, rowId: row.id, actionId: "delete" },
    );
  }

  function openDialog(next: DialogState) {
    if (pending) return;
    setDialog(next);
  }

  function rowAction(row: PortfolioRow, action: "archive" | "restore") {
    card.rowAction(
      {
        list: "portfolios",
        change:
          action === "archive"
            ? { kind: "archive", id: row.id }
            : { kind: "restore", row },
      },
      () =>
        action === "archive"
          ? actions.archive(row.id)
          : actions.restore(row.id),
      (result) =>
        rowAnswer(result, action, MESSAGES, {
          usedBy: usedBy(row.id),
          links: { portfolio_has_holdings: toAssets(row.id) },
        }),
      {
        done: `${action === "archive" ? "Archivaste" : "Restauraste"} ${row.name}`,
        rowId: row.id,
        actionId: action,
        askName: () => setDialog({ kind: "restore", row }),
      },
    );
  }

  function submit(
    dialog: DialogState,
    name: string,
    change: ListChange<PortfolioRow>,
    call: () => Promise<WriteResult>,
    done: string,
  ): boolean {
    return card.dialogAction({ list: "portfolios", change }, call, MESSAGES, {
      done,
      reopen: (error) =>
        setDialog({ ...dialog, initial: name, initialError: error }),
    });
  }

  return (
    <SetupCard
      heading={card.heading}
      pending={pending}
      title={COPY.title}
      description={COPY.description}
      addLabel={COPY.addLabel}
      onAdd={() => openDialog({ kind: "create" })}
    >
      <ActiveList
        view={view}
        title={COPY.title}
        emptyText={COPY.emptyText}
        truncatedText={COPY.truncated}
        columns={[
          ...DATA_COLUMNS,
          actionsColumn<PortfolioRow>(
            [
              {
                id: "rename",
                icon: Pencil,
                tooltip: "Renombrar",
                label: (row) => `Renombrar ${row.name}`,
                onClick: (row) => openDialog({ kind: "rename", row }),
              },
              {
                id: "archive",
                icon: Archive,
                tooltip: "Archivar",
                label: (row) => `Archivar ${row.name}`,
                onClick: (row) => rowAction(row, "archive"),
              },
              ...(deleteAction ? [deleteAction] : []),
            ],
            { pending },
          ),
        ]}
      />
      <ArchivedList
        view={view}
        title={COPY.title}
        label={COPY.archivedLabel}
        emptyText={COPY.noMoreArchived}
        firstPageLabel={COPY.firstPageLabel}
        pending={pending}
        columns={[
          ...DATA_COLUMNS,
          actionsColumn<PortfolioRow>(
            [
              {
                id: "restore",
                icon: ArchiveRestore,
                tooltip: "Restaurar",
                label: (row) => `Restaurar ${row.name}`,
                onClick: (row) => rowAction(row, "restore"),
              },
              ...(deleteAction ? [deleteAction] : []),
            ],
            { pending },
          ),
        ]}
      />
      {deleting && remove && (
        <ConfirmDialog
          title={`¿Borrar ${deleting.name}?`}
          description="No se puede deshacer."
          confirmLabel="Borrar"
          returnFocusTo={card.focusHeading}
          onClose={() => setDeleting(null)}
          onConfirm={() => deleteRow(deleting, remove)}
        />
      )}
      {dialog?.kind === "create" && (
        <NameDialog
          onClose={() => setDialog(null)}
          returnFocusTo={card.focusHeading}
          title={COPY.createDialog.title}
          description={COPY.createDialog.description}
          submitLabel="Crear"
          initial={dialog.initial}
          initialError={dialog.initialError}
          blankError={MESSAGES.invalid}
          onSubmit={(name) =>
            submit(
              dialog,
              name,
              { kind: "create", row: { id: temporaryId(), name } },
              () => actions.create({ name }),
              `Creaste ${name}`,
            )
          }
        />
      )}
      {dialog?.kind === "rename" && (
        <NameDialog
          key={dialog.row.id}
          onClose={() => setDialog(null)}
          returnFocusTo={card.focusHeading}
          title={COPY.renameDialog.title}
          description={COPY.renameDialog.description}
          submitLabel="Guardar"
          initial={dialog.initial ?? dialog.row.name}
          initialError={dialog.initialError}
          blankError={MESSAGES.invalid}
          onSubmit={(name) =>
            // The same name sends no write, so nothing reports a row archived
            // from another tab meanwhile. A refused rename may have committed,
            // so once reopened the old name is a real write.
            (dialog.initialError === undefined && name === dialog.row.name) ||
            submit(
              dialog,
              name,
              { kind: "update", row: { ...dialog.row, name } },
              () => actions.rename(dialog.row.id, { name }),
              `Renombraste ${dialog.row.name} a ${name}`,
            )
          }
        />
      )}
      {dialog?.kind === "restore" && (
        <NameDialog
          key={dialog.row.id}
          onClose={() => setDialog(null)}
          returnFocusTo={card.focusHeading}
          savedRemovesOpener
          title={COPY.restoreDialog.title}
          description={COPY.restoreDialog.description}
          submitLabel="Restaurar"
          initial={dialog.initial ?? dialog.row.name}
          initialError={dialog.initialError}
          blankError={MESSAGES.invalid}
          onSubmit={(name) =>
            submit(
              dialog,
              name,
              { kind: "restore", row: { ...dialog.row, name } },
              () => actions.restore(dialog.row.id, { name }),
              `Restauraste ${name}`,
            )
          }
        />
      )}
    </SetupCard>
  );
}
