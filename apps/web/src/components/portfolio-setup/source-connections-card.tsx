"use client";

import { Archive, ArchiveRestore, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { TruncatedText, actionsColumn } from "@/components/ui/data-table";
import { PAGE_ROW_LIMIT } from "@/lib/portfolio-setup/limits";
import {
  deleteAccountDescription,
  deleteMessages,
  WRITE_MESSAGES,
} from "@/lib/portfolio-setup/messages";
import type { WriteResult } from "@/lib/portfolio-setup/write-result";
import type {
  PortfolioRow,
  SourceConnectionRow,
  SourceConnectionsView,
} from "@/lib/portfolio-setup/read";
import { InstitutionIcon } from "./institution-field";
import { dialogAnswer, rowAnswer } from "./answers";
import { temporaryId } from "./list-change";
import {
  ActiveList,
  ArchivedList,
  type Retry,
  SetupCard,
  useSetupCard,
} from "./setup-card";
import type { SetupRun } from "./setup-actions";
import {
  SourceConnectionDialog,
  type SourceConnectionFields,
  accountRow,
  initialFields,
} from "./source-connection-dialog";

const MESSAGES = WRITE_MESSAGES.source_connections;

type DialogState =
  | ({ kind: "create" } & Retry<SourceConnectionFields>)
  | ({ kind: "edit"; row: SourceConnectionRow } & Retry<SourceConnectionFields>)
  | ({
      kind: "restore";
      row: SourceConnectionRow;
    } & Retry<SourceConnectionFields>);

// The report column's header names the report, so it shows only the status;
// the narrow second line, with no header, adds it.
function reportStatus(row: SourceConnectionRow): string {
  return row.includeInTaxReport ? "Incluida" : "No incluida";
}

export type SourceConnectionActions = {
  create: (input: unknown) => Promise<WriteResult>;
  update: (id: string, input: unknown) => Promise<WriteResult>;
  archive: (id: string) => Promise<WriteResult>;
  restore: (id: string, input: unknown) => Promise<WriteResult>;
  // A page that deletes accounts that never held anything.
  delete?: (id: string) => Promise<WriteResult>;
};

// Below @2xl the portfolio and report status take a muted second line; from
// @2xl each has its own column.
const COLUMNS: ColumnDef<SourceConnectionRow>[] = [
  {
    id: "institution",
    header: "Cuenta",
    meta: { className: "@2xl:w-36" },
    cell: ({ row: { original: row } }) => (
      <>
        <span className="flex min-w-0 items-center gap-2">
          <InstitutionIcon name={row.institution} />
          <span className="block truncate" title={row.institution}>
            {row.institution}
          </span>
        </span>
        <TruncatedText
          className="pl-6 text-xs text-muted-foreground @2xl:hidden"
          text={`${row.portfolio.name} · ${reportStatus(row)} en el reporte`}
        />
      </>
    ),
  },
  {
    id: "portfolio",
    header: "Cartera",
    meta: { className: "hidden @2xl:table-cell" },
    cell: ({ row }) => <TruncatedText text={row.original.portfolio.name} />,
  },
  {
    id: "report",
    header: "Reporte",
    size: 120,
    meta: { className: "hidden @2xl:table-cell" },
    cell: ({ row }) => <TruncatedText text={reportStatus(row.original)} />,
  },
];

export function SourceConnectionsCard({
  view,
  pending,
  run,
  portfolios,
  actions,
  deletesUploads,
}: {
  view: SourceConnectionsView;
  pending: boolean;
  run: SetupRun;
  portfolios: PortfolioRow[];
  actions: SourceConnectionActions;
  // The accounts whose delete would go through and take their uploads.
  deletesUploads?: readonly string[];
}) {
  const card = useSetupCard({ run, pending });
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [deleting, setDeleting] = useState<SourceConnectionRow | null>(null);
  const remove = actions.delete;
  const deleteAction = remove && {
    id: "delete",
    icon: Trash2,
    tooltip: "Borrar",
    label: (row: SourceConnectionRow) => `Borrar ${row.institution}`,
    onClick: (row: SourceConnectionRow) => !pending && setDeleting(row),
  };

  function deleteRow(
    row: SourceConnectionRow,
    call: (id: string) => Promise<WriteResult>,
  ) {
    card.rowAction(
      { list: "sourceConnections", change: { kind: "delete", id: row.id } },
      () => call(row.id),
      (result) => dialogAnswer(result, deleteMessages(MESSAGES)),
      {
        done: `Borraste ${row.institution}`,
        rowId: row.id,
        actionId: "delete",
      },
    );
  }

  function openDialog(next: DialogState) {
    if (pending) return;
    setDialog(next);
  }

  function archive(row: SourceConnectionRow) {
    card.rowAction(
      { list: "sourceConnections", change: { kind: "archive", id: row.id } },
      () => actions.archive(row.id),
      (result) => rowAnswer(result, "archive", MESSAGES),
      {
        done: `Archivaste ${row.institution}`,
        rowId: row.id,
        actionId: "archive",
      },
    );
  }

  function submit(
    dialog: DialogState,
    fields: SourceConnectionFields,
    kind: "create" | "update" | "restore",
    row: SourceConnectionRow,
    call: () => Promise<WriteResult>,
    done: string,
  ): boolean {
    return card.dialogAction(
      { list: "sourceConnections", change: { kind, row } },
      call,
      MESSAGES,
      {
        done: `${done} ${row.institution}`,
        reopen: (error) =>
          setDialog({ ...dialog, initial: fields, initialError: error }),
      },
    );
  }

  function dialogProps(dialog: DialogState, row: SourceConnectionRow | null) {
    return {
      initial: dialog.initial ?? initialFields(row, portfolios),
      initialError: dialog.initialError,
      portfolios,
      returnFocusTo: card.focusHeading,
      onClose: () => setDialog(null),
    };
  }

  return (
    <SetupCard
      heading={card.heading}
      pending={pending}
      title="Cuentas"
      description="Dónde tenés tus inversiones"
      addLabel="Agregar cuenta"
      onAdd={() => openDialog({ kind: "create" })}
    >
      <ActiveList
        view={view}
        title="Cuentas"
        emptyText="Todavía no agregaste cuentas."
        truncatedText={`Mostrando las ${PAGE_ROW_LIMIT} más recientes.`}
        columns={[
          ...COLUMNS,
          actionsColumn<SourceConnectionRow>(
            [
              {
                id: "edit",
                icon: Pencil,
                tooltip: "Editar",
                label: (row) => `Editar ${row.institution}`,
                onClick: (row) => openDialog({ kind: "edit", row }),
              },
              {
                id: "archive",
                icon: Archive,
                tooltip: "Archivar",
                label: (row) => `Archivar ${row.institution}`,
                onClick: archive,
              },
              ...(deleteAction ? [deleteAction] : []),
            ],
            { pending },
          ),
        ]}
      />
      <ArchivedList
        view={view}
        title="Cuentas"
        label="Archivadas"
        emptyText="No hay más cuentas archivadas."
        firstPageLabel="Ver las más recientes"
        pending={pending}
        columns={[
          ...COLUMNS,
          actionsColumn<SourceConnectionRow>(
            [
              {
                id: "restore",
                icon: ArchiveRestore,
                tooltip: "Restaurar",
                label: (row) => `Restaurar ${row.institution}`,
                onClick: (row) => openDialog({ kind: "restore", row }),
              },
              ...(deleteAction ? [deleteAction] : []),
            ],
            { pending },
          ),
        ]}
      />
      {deleting && remove && (
        <ConfirmDialog
          title={`¿Borrar ${deleting.institution}?`}
          description={deleteAccountDescription(
            deletesUploads?.includes(deleting.id) ?? false,
          )}
          confirmLabel="Borrar"
          returnFocusTo={card.focusHeading}
          onClose={() => setDeleting(null)}
          onConfirm={() => deleteRow(deleting, remove)}
        />
      )}
      {dialog?.kind === "create" && (
        <SourceConnectionDialog
          title="Agregar cuenta"
          description="Contanos dónde tenés inversiones."
          submitLabel="Agregar"
          {...dialogProps(dialog, null)}
          onSubmit={(fields, portfolio) =>
            submit(
              dialog,
              fields,
              "create",
              accountRow(temporaryId(), fields, portfolio),
              () => actions.create(fields),
              "Agregaste",
            )
          }
        />
      )}
      {dialog?.kind === "edit" && (
        <SourceConnectionDialog
          key={dialog.row.id}
          title="Editar cuenta"
          description="Cambiá los datos de la cuenta."
          submitLabel="Guardar"
          {...dialogProps(dialog, dialog.row)}
          onSubmit={(fields, portfolio) =>
            submit(
              dialog,
              fields,
              "update",
              accountRow(dialog.row.id, fields, portfolio),
              () => actions.update(dialog.row.id, fields),
              "Guardaste",
            )
          }
        />
      )}
      {dialog?.kind === "restore" && (
        <SourceConnectionDialog
          key={dialog.row.id}
          title="Restaurar cuenta"
          description="Revisá los datos antes de restaurarla."
          submitLabel="Restaurar"
          {...dialogProps(dialog, dialog.row)}
          savedRemovesOpener
          onSubmit={(fields, portfolio) =>
            submit(
              dialog,
              fields,
              "restore",
              accountRow(dialog.row.id, fields, portfolio),
              () => actions.restore(dialog.row.id, fields),
              "Restauraste",
            )
          }
        />
      )}
    </SetupCard>
  );
}
