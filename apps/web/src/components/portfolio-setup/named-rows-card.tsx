"use client";

import { Archive, ArchiveRestore, Pencil } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { IconButton } from "@/components/ui/icon-button";
import type { ListView, NamedRow } from "@/lib/portfolio-setup/read";
import type { WriteResult } from "@/lib/portfolio-setup/write-result";
import { type WriteMessages, rowAnswer } from "./answers";
import { NameDialog } from "./name-dialog";
import {
  ActiveList,
  ArchivedList,
  SetupCard,
  useSetupCard,
} from "./setup-card";

type DialogState =
  | { kind: "create" }
  | { kind: "rename"; row: NamedRow }
  | { kind: "restore"; row: NamedRow };

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

// A card of rows that are only a name: create, rename, archive and restore.
export function NamedRowsCard({
  view,
  copy,
  actions,
  messages,
  usedBy,
}: {
  view: ListView<NamedRow>;
  copy: NamedRowsCopy;
  actions: NamedRowsActions;
  messages: WriteMessages;
  // How the active accounts that use a row are named.
  usedBy: (id: string) => string[];
}) {
  const card = useSetupCard();
  const [dialog, setDialog] = useState<DialogState | null>(null);

  function openDialog(next: DialogState) {
    if (card.pending) return;
    setDialog(next);
  }

  function rowAction(row: NamedRow, action: "archive" | "restore") {
    card.rowAction(
      () =>
        action === "archive"
          ? actions.archive(row.id)
          : actions.restore(row.id),
      (result) => rowAnswer(result, action, messages, usedBy(row.id)),
      {
        done: `${action === "archive" ? "Archivaste" : "Restauraste"} ${row.name}`,
        // Defensive: the openers ignore clicks while an action is pending.
        askName: () => setDialog((open) => open ?? { kind: "restore", row }),
      },
    );
  }

  return (
    <SetupCard
      heading={card.heading}
      pending={card.pending}
      title={copy.title}
      description={copy.description}
      addLabel={copy.addLabel}
      onAdd={() => openDialog({ kind: "create" })}
    >
      <ActiveList
        view={view}
        emptyText={copy.emptyText}
        truncatedText={copy.truncated}
        renderRow={(row) => (
          <>
            <span className="min-w-0 truncate text-sm">{row.name}</span>
            <span className="flex shrink-0 gap-1">
              <IconButton
                icon={Pencil}
                tooltip="Renombrar"
                label={`Renombrar ${row.name}`}
                pending={card.pending}
                onClick={() => openDialog({ kind: "rename", row })}
              />
              <IconButton
                icon={Archive}
                tooltip="Archivar"
                label={`Archivar ${row.name}`}
                pending={card.pending}
                onClick={() => rowAction(row, "archive")}
              />
            </span>
          </>
        )}
      />
      <ArchivedList
        view={view}
        label={copy.archivedLabel}
        emptyText={copy.noMoreArchived}
        firstPageLabel={copy.firstPageLabel}
        renderRow={(row) => (
          <>
            <span className="min-w-0 truncate text-sm text-muted-foreground">
              {row.name}
            </span>
            <IconButton
              icon={ArchiveRestore}
              tooltip="Restaurar"
              label={`Restaurar ${row.name}`}
              pending={card.pending}
              onClick={() => rowAction(row, "restore")}
            />
          </>
        )}
      />
      {dialog?.kind === "create" && (
        <NameDialog
          onClose={() => setDialog(null)}
          returnFocusTo={card.focusHeading}
          title={copy.createDialog.title}
          description={copy.createDialog.description}
          submitLabel="Crear"
          messages={messages}
          onSubmit={(name) => actions.create({ name })}
          onSaved={(name) => toast.success(`Creaste ${name}`)}
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
          defaultValue={dialog.row.name}
          messages={messages}
          onSubmit={(name) => actions.rename(dialog.row.id, { name })}
          onSaved={(name) =>
            name !== dialog.row.name &&
            toast.success(`Renombraste ${dialog.row.name} a ${name}`)
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
          defaultValue={dialog.row.name}
          messages={messages}
          onSubmit={(name) => actions.restore(dialog.row.id, { name })}
          onSaved={(name) => toast.success(`Restauraste ${name}`)}
        />
      )}
    </SetupCard>
  );
}
