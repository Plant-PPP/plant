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
  SELF_HOLDER_LABEL,
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
  type HolderChoices,
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

function holderName(row: SourceConnectionRow): string {
  return row.holder?.name ?? SELF_HOLDER_LABEL;
}

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

// Below @2xl the holder follows the institution and the portfolio and report
// status take a muted second line; from @2xl each has its own column. A page
// without holders shows none.
const dataColumns = (
  withHolders: boolean,
): ColumnDef<SourceConnectionRow>[] => [
  {
    id: "institution",
    header: "Cuenta",
    meta: { className: "@2xl:w-36" },
    cell: ({ row: { original: row } }) => (
      <>
        <span className="flex min-w-0 items-center gap-2">
          <InstitutionIcon name={row.institution} />
          <span
            className="block truncate"
            title={
              withHolders
                ? `${row.institution} · ${holderName(row)}`
                : row.institution
            }
          >
            {row.institution}
            {withHolders && (
              <span className="@2xl:hidden"> · {holderName(row)}</span>
            )}
          </span>
        </span>
        <TruncatedText
          className="pl-6 text-xs text-muted-foreground @2xl:hidden"
          text={`${row.portfolio.name} · ${reportStatus(row)} en el reporte`}
        />
      </>
    ),
  },
  ...(withHolders
    ? [
        {
          id: "holder",
          header: "Titular",
          meta: { className: "hidden @2xl:table-cell" },
          cell: ({ row }) => <TruncatedText text={holderName(row.original)} />,
        } satisfies ColumnDef<SourceConnectionRow>,
      ]
    : []),
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
  holders,
  portfolios,
  actions,
  deletesUploads,
}: {
  view: SourceConnectionsView;
  pending: boolean;
  run: SetupRun;
  holders?: HolderChoices;
  portfolios: PortfolioRow[];
  actions: SourceConnectionActions;
  // Whether deleting an account also deletes its uploads.
  deletesUploads?: (accountId: string) => boolean;
}) {
  const columns = dataColumns(holders !== undefined);
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
      holders,
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
      description={
        holders
          ? "Dónde tenés tus inversiones, y de quién son"
          : "Dónde tenés tus inversiones"
      }
      addLabel="Agregar cuenta"
      onAdd={() => openDialog({ kind: "create" })}
    >
      <ActiveList
        view={view}
        title="Cuentas"
        emptyText="Todavía no agregaste cuentas."
        truncatedText={`Mostrando las ${PAGE_ROW_LIMIT} más recientes.`}
        columns={[
          ...columns,
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
          ...columns,
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
            deletesUploads?.(deleting.id) ?? false,
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
          onSubmit={(fields, chosen) =>
            submit(
              dialog,
              fields,
              "create",
              accountRow(temporaryId(), fields, chosen),
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
          onSubmit={(fields, chosen) =>
            submit(
              dialog,
              fields,
              "update",
              accountRow(dialog.row.id, fields, chosen),
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
          onSubmit={(fields, chosen) =>
            submit(
              dialog,
              fields,
              "restore",
              accountRow(dialog.row.id, fields, chosen),
              () => actions.restore(dialog.row.id, fields),
              "Restauraste",
            )
          }
        />
      )}
    </SetupCard>
  );
}
