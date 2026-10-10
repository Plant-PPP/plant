"use client";

import { Archive, ArchiveRestore, Pencil } from "lucide-react";
import { useState } from "react";
import {
  archiveSourceConnection,
  createSourceConnection,
  restoreSourceConnection,
  updateSourceConnection,
} from "@/app/(app)/accounts/actions";
import type { ColumnDef } from "@tanstack/react-table";
import { TruncatedText, actionsColumn } from "@/components/ui/data-table";
import { PAGE_ROW_LIMIT } from "@/lib/portfolio-setup/limits";
import {
  SELF_HOLDER_LABEL,
  WRITE_MESSAGES,
} from "@/lib/portfolio-setup/messages";
import type { WriteResult } from "@/lib/portfolio-setup/write-result";
import type {
  HolderRow,
  PortfolioRow,
  SourceConnectionRow,
  SourceConnectionsView,
} from "@/lib/portfolio-setup/read";
import { sourceConnectionLabel } from "./accounts-using";
import { InstitutionIcon } from "./institution-field";
import { rowAnswer } from "./answers";
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

function holderName(row: SourceConnectionRow): string {
  return row.holder?.name ?? SELF_HOLDER_LABEL;
}

// The report column's header names the report, so it shows only the status;
// the narrow second line, with no header, adds it.
function reportStatus(row: SourceConnectionRow): string {
  return row.includeInTaxReport ? "Incluida" : "No incluida";
}

// Below @2xl the holder follows the institution and the portfolio and report
// status take a muted second line; from @2xl each has its own column.
const DATA_COLUMNS: ColumnDef<SourceConnectionRow>[] = [
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
            title={`${row.institution} · ${holderName(row)}`}
          >
            {row.institution}
            <span className="@2xl:hidden"> · {holderName(row)}</span>
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
    id: "holder",
    header: "Titular",
    meta: { className: "hidden @2xl:table-cell" },
    cell: ({ row }) => <TruncatedText text={holderName(row.original)} />,
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
  holders,
  portfolios,
}: {
  view: SourceConnectionsView;
  pending: boolean;
  run: SetupRun;
  holders: HolderRow[];
  portfolios: PortfolioRow[];
}) {
  const card = useSetupCard({ run, pending });
  const [dialog, setDialog] = useState<DialogState | null>(null);

  function openDialog(next: DialogState) {
    if (pending) return;
    setDialog(next);
  }

  function archive(row: SourceConnectionRow) {
    card.rowAction(
      { list: "sourceConnections", change: { kind: "archive", id: row.id } },
      () => archiveSourceConnection(row.id),
      (result) => rowAnswer(result, "archive", MESSAGES),
      {
        done: `Archivaste ${sourceConnectionLabel(row)}`,
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
        done: `${done} ${sourceConnectionLabel(row)}`,
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
      description="Dónde tenés tus inversiones, y de quién son"
      addLabel="Agregar cuenta"
      onAdd={() => openDialog({ kind: "create" })}
    >
      <ActiveList
        view={view}
        title="Cuentas"
        emptyText="Todavía no agregaste cuentas."
        truncatedText={`Mostrando las ${PAGE_ROW_LIMIT} más recientes.`}
        columns={[
          ...DATA_COLUMNS,
          actionsColumn<SourceConnectionRow>(
            [
              {
                id: "edit",
                icon: Pencil,
                tooltip: "Editar",
                label: (row) => `Editar ${sourceConnectionLabel(row)}`,
                onClick: (row) => openDialog({ kind: "edit", row }),
              },
              {
                id: "archive",
                icon: Archive,
                tooltip: "Archivar",
                label: (row) => `Archivar ${sourceConnectionLabel(row)}`,
                onClick: archive,
              },
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
          ...DATA_COLUMNS,
          actionsColumn<SourceConnectionRow>(
            [
              {
                id: "restore",
                icon: ArchiveRestore,
                tooltip: "Restaurar",
                label: (row) => `Restaurar ${sourceConnectionLabel(row)}`,
                onClick: (row) => openDialog({ kind: "restore", row }),
              },
            ],
            { pending },
          ),
        ]}
      />
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
              () => createSourceConnection(fields),
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
              () => updateSourceConnection(dialog.row.id, fields),
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
              () => restoreSourceConnection(dialog.row.id, fields),
              "Restauraste",
            )
          }
        />
      )}
    </SetupCard>
  );
}
