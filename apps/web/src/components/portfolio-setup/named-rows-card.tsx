"use client";

import { Archive, ArchiveRestore, Pencil } from "lucide-react";
import { useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { TruncatedText, actionsColumn } from "@/components/ui/data-table";
import type { ListView, NamedRow } from "@/lib/portfolio-setup/read";
import type { WriteResult } from "@/lib/portfolio-setup/write-result";
import { type WriteMessages, rowAnswer } from "./answers";
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
  | ({ kind: "rename"; row: NamedRow } & Retry<string>)
  | ({ kind: "restore"; row: NamedRow } & Retry<string>);

type DialogCopy = { title: string; description: string };

export type NamedRowsCopy = {
  title: string;
  description: string;
  addLabel: string;
  // Shown when there is no active row.
  emptyText: string;
  archivedLabel: string;
  noMoreArchived: string;
  firstPageLabel: string;
  truncated: string;
  createDialog: DialogCopy;
  renameDialog: DialogCopy;
  // For a restore whose name an active row took.
  restoreDialog: DialogCopy;
};

export type NamedRowsActions = {
  create: (input: unknown) => Promise<WriteResult>;
  rename: (id: unknown, input: unknown) => Promise<WriteResult>;
  archive: (id: unknown) => Promise<WriteResult>;
  restore: (id: unknown, input?: unknown) => Promise<WriteResult>;
};

const DATA_COLUMNS: ColumnDef<NamedRow>[] = [
  {
    id: "name",
    header: "Nombre",
    cell: ({ row }) => <TruncatedText text={row.original.name} />,
  },
];

// A list section of rows that are only a name: create, rename, archive and
// restore.
export function NamedRowsCard({
  list,
  view,
  pending,
  run,
  copy,
  actions,
  messages,
  usedBy,
}: {
  list: "portfolios" | "holders";
  view: ListView<NamedRow>;
  pending: boolean;
  run: SetupRun;
  copy: NamedRowsCopy;
  actions: NamedRowsActions;
  messages: WriteMessages;
  // How the active accounts that use a row are named.
  usedBy: (id: string) => string[];
}) {
  const card = useSetupCard({ run, pending });
  const [dialog, setDialog] = useState<DialogState | null>(null);

  function openDialog(next: DialogState) {
    if (pending) return;
    setDialog(next);
  }

  function rowAction(row: NamedRow, action: "archive" | "restore") {
    card.rowAction(
      {
        list,
        change:
          action === "archive"
            ? { kind: "archive", id: row.id }
            : { kind: "restore", row },
      },
      () =>
        action === "archive"
          ? actions.archive(row.id)
          : actions.restore(row.id),
      (result) => rowAnswer(result, action, messages, usedBy(row.id)),
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
    change: ListChange<NamedRow>,
    call: () => Promise<WriteResult>,
    done: string,
  ): boolean {
    return card.dialogAction({ list, change }, call, messages, {
      done,
      reopen: (error) =>
        setDialog({ ...dialog, initial: name, initialError: error }),
    });
  }

  return (
    <SetupCard
      heading={card.heading}
      pending={pending}
      title={copy.title}
      description={copy.description}
      addLabel={copy.addLabel}
      onAdd={() => openDialog({ kind: "create" })}
    >
      <ActiveList
        view={view}
        title={copy.title}
        emptyText={copy.emptyText}
        truncatedText={copy.truncated}
        columns={[
          ...DATA_COLUMNS,
          actionsColumn<NamedRow>(
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
            ],
            { pending },
          ),
        ]}
      />
      <ArchivedList
        view={view}
        title={copy.title}
        label={copy.archivedLabel}
        emptyText={copy.noMoreArchived}
        firstPageLabel={copy.firstPageLabel}
        pending={pending}
        columns={[
          ...DATA_COLUMNS,
          actionsColumn<NamedRow>(
            [
              {
                id: "restore",
                icon: ArchiveRestore,
                tooltip: "Restaurar",
                label: (row) => `Restaurar ${row.name}`,
                onClick: (row) => rowAction(row, "restore"),
              },
            ],
            { pending },
          ),
        ]}
      />
      {dialog?.kind === "create" && (
        <NameDialog
          onClose={() => setDialog(null)}
          returnFocusTo={card.focusHeading}
          title={copy.createDialog.title}
          description={copy.createDialog.description}
          submitLabel="Crear"
          initial={dialog.initial}
          initialError={dialog.initialError}
          blankError={messages.invalid}
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
          title={copy.renameDialog.title}
          description={copy.renameDialog.description}
          submitLabel="Guardar"
          initial={dialog.initial ?? dialog.row.name}
          initialError={dialog.initialError}
          blankError={messages.invalid}
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
          title={copy.restoreDialog.title}
          description={copy.restoreDialog.description}
          submitLabel="Restaurar"
          initial={dialog.initial ?? dialog.row.name}
          initialError={dialog.initialError}
          blankError={messages.invalid}
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
