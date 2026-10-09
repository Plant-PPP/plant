"use client";

import { Archive, ArchiveRestore, Pencil } from "lucide-react";
import { useState } from "react";
import type { ListView, PortfolioRow } from "@/lib/portfolio-setup/read";
import type { WriteResult } from "@/lib/portfolio-setup/write-result";
import { type WriteMessages, rowAnswer } from "./answers";
import { NameSheet } from "./name-sheet";
import { ArchivedList, RowButton, SetupCard, useSetupCard } from "./setup-card";

type NamedRow = PortfolioRow;

type SheetState =
  | { kind: "create" }
  | { kind: "rename"; row: NamedRow }
  | { kind: "restore"; row: NamedRow };

type SheetCopy = { title: string; description: string };

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
  createSheet: SheetCopy;
  renameSheet: SheetCopy;
  // For a restore whose name an active row took.
  restoreSheet: SheetCopy;
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
  // The institutions of the active accounts that use a row.
  usedBy: (id: string) => string[];
}) {
  const card = useSetupCard(view.archivedPage);
  const [sheet, setSheet] = useState<SheetState | null>(null);

  function openSheet(next: SheetState) {
    if (card.pending) return;
    card.clearMessages();
    setSheet(next);
  }

  function rowAction(row: NamedRow, action: "archive" | "restore") {
    card.rowAction(
      () =>
        action === "archive"
          ? actions.archive(row.id)
          : actions.restore(row.id),
      (result) => rowAnswer(result, action, messages, usedBy(row.id)),
      {
        done: `${action === "archive" ? "Archivaste" : "Restauraste"} ${row.name}.`,
        // Defensive: the openers ignore clicks while an action is pending.
        askName: () => setSheet((open) => open ?? { kind: "restore", row }),
      },
    );
  }

  return (
    <SetupCard
      heading={card.heading}
      alert={card.alert}
      notice={card.notice}
      pending={card.pending}
      title={copy.title}
      description={copy.description}
      addLabel={copy.addLabel}
      onAdd={() => openSheet({ kind: "create" })}
    >
      {view.active.length === 0 ? (
        <p className="text-sm text-muted-foreground">{copy.emptyText}</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {view.active.map((row) => (
            <li
              key={row.id}
              className="flex items-center justify-between gap-2 px-3 py-2"
            >
              <span className="min-w-0 truncate text-sm">{row.name}</span>
              <span className="flex shrink-0 gap-1">
                <RowButton
                  pending={card.pending}
                  icon={<Pencil />}
                  label="Renombrar"
                  rowName={row.name}
                  onClick={() => openSheet({ kind: "rename", row })}
                />
                <RowButton
                  pending={card.pending}
                  icon={<Archive />}
                  label="Archivar"
                  rowName={row.name}
                  onClick={() => rowAction(row, "archive")}
                />
              </span>
            </li>
          ))}
        </ul>
      )}
      {view.activeTruncated && (
        <p className="text-xs text-muted-foreground">{copy.truncated}</p>
      )}
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
            <RowButton
              pending={card.pending}
              icon={<ArchiveRestore />}
              label="Restaurar"
              rowName={row.name}
              onClick={() => rowAction(row, "restore")}
            />
          </>
        )}
      />
      {sheet?.kind === "create" && (
        <NameSheet
          onClose={() => setSheet(null)}
          returnFocusTo={card.focusHeading}
          title={copy.createSheet.title}
          description={copy.createSheet.description}
          submitLabel="Crear"
          messages={messages}
          onSubmit={(name) => actions.create({ name })}
          onSaved={(name) => card.setNotice(`Creaste ${name}.`)}
        />
      )}
      {sheet?.kind === "rename" && (
        <NameSheet
          key={sheet.row.id}
          onClose={() => setSheet(null)}
          returnFocusTo={card.focusHeading}
          title={copy.renameSheet.title}
          description={copy.renameSheet.description}
          submitLabel="Guardar"
          defaultValue={sheet.row.name}
          messages={messages}
          onSubmit={(name) => actions.rename(sheet.row.id, { name })}
          onSaved={(name) =>
            name !== sheet.row.name &&
            card.setNotice(`Renombraste ${sheet.row.name} a ${name}.`)
          }
        />
      )}
      {sheet?.kind === "restore" && (
        <NameSheet
          key={sheet.row.id}
          onClose={() => setSheet(null)}
          returnFocusTo={card.focusHeading}
          savedRemovesOpener
          title={copy.restoreSheet.title}
          description={copy.restoreSheet.description}
          submitLabel="Restaurar"
          defaultValue={sheet.row.name}
          messages={messages}
          onSubmit={(name) => actions.restore(sheet.row.id, { name })}
          onSaved={(name) => card.setNotice(`Restauraste ${name}.`)}
        />
      )}
    </SetupCard>
  );
}
