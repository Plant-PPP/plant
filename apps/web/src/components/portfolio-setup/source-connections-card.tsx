"use client";

import { Archive, ArchiveRestore, Pencil } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
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
import type {
  HolderRow,
  PortfolioRow,
  SourceConnectionRow,
  SourceConnectionsView,
} from "@/lib/portfolio-setup/read";
import { sourceConnectionLabel } from "./accounts-using";
import { rowAnswer } from "./answers";
import {
  ActiveList,
  ArchivedList,
  SetupCard,
  useSetupCard,
} from "./setup-card";
import {
  SourceConnectionDialog,
  initialFields,
} from "./source-connection-dialog";

const MESSAGES = WRITE_MESSAGES.source_connections;

type DialogState =
  | { kind: "create" }
  | { kind: "edit"; row: SourceConnectionRow }
  | { kind: "restore"; row: SourceConnectionRow };

function holderName(row: SourceConnectionRow): string {
  return row.holder?.name ?? SELF_HOLDER_LABEL;
}

function reportStatus(row: SourceConnectionRow): string {
  return row.includeInTaxReport
    ? "Incluida en el reporte"
    : "Fuera del reporte";
}

// Below @2xl the holder follows the institution and the portfolio and report
// status take a muted second line; from @2xl each has its own column.
const DATA_COLUMNS: ColumnDef<SourceConnectionRow>[] = [
  {
    id: "institution",
    header: "Cuenta",
    cell: ({ row: { original: row } }) => (
      <>
        <span
          className="block truncate"
          title={`${row.institution} · ${holderName(row)}`}
        >
          {row.institution}
          <span className="@2xl:hidden"> · {holderName(row)}</span>
        </span>
        <TruncatedText
          className="text-xs text-muted-foreground @2xl:hidden"
          text={`${row.portfolio.name} · ${reportStatus(row)}`}
        />
      </>
    ),
  },
  {
    id: "holder",
    header: "Titular",
    size: 128,
    meta: { className: "hidden @2xl:table-cell" },
    cell: ({ row }) => <TruncatedText text={holderName(row.original)} />,
  },
  {
    id: "portfolio",
    header: "Cartera",
    size: 128,
    meta: { className: "hidden @2xl:table-cell" },
    cell: ({ row }) => <TruncatedText text={row.original.portfolio.name} />,
  },
  {
    id: "report",
    header: "Reporte",
    size: 184,
    meta: { className: "hidden @2xl:table-cell" },
    cell: ({ row }) => <TruncatedText text={reportStatus(row.original)} />,
  },
];

export function SourceConnectionsCard({
  view,
  holders,
  portfolios,
}: {
  view: SourceConnectionsView;
  holders: HolderRow[];
  portfolios: PortfolioRow[];
}) {
  const card = useSetupCard();
  const [dialog, setDialog] = useState<DialogState | null>(null);

  function openDialog(next: DialogState) {
    if (card.pending) return;
    setDialog(next);
  }

  function archive(row: SourceConnectionRow) {
    card.rowAction(
      () => archiveSourceConnection(row.id),
      (result) => rowAnswer(result, "archive", MESSAGES),
      { done: `Archivaste ${sourceConnectionLabel(row)}` },
    );
  }

  return (
    <SetupCard
      heading={card.heading}
      pending={card.pending}
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
            { pending: card.pending },
          ),
        ]}
      />
      <ArchivedList
        view={view}
        title="Cuentas"
        label="Archivadas"
        emptyText="No hay más cuentas archivadas."
        firstPageLabel="Ver las más recientes"
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
            { pending: card.pending },
          ),
        ]}
      />
      {dialog?.kind === "create" && (
        <SourceConnectionDialog
          title="Agregar cuenta"
          description="Contanos dónde tenés inversiones."
          submitLabel="Agregar"
          initial={initialFields(null, portfolios)}
          holders={holders}
          portfolios={portfolios}
          returnFocusTo={card.focusHeading}
          onClose={() => setDialog(null)}
          onSubmit={(fields) => createSourceConnection(fields)}
          onSaved={(label) => toast.success(`Agregaste ${label}`)}
        />
      )}
      {dialog?.kind === "edit" && (
        <SourceConnectionDialog
          key={dialog.row.id}
          title="Editar cuenta"
          description="Cambiá los datos de la cuenta."
          submitLabel="Guardar"
          initial={initialFields(dialog.row, portfolios)}
          holders={holders}
          portfolios={portfolios}
          returnFocusTo={card.focusHeading}
          onClose={() => setDialog(null)}
          onSubmit={(fields) => updateSourceConnection(dialog.row.id, fields)}
          onSaved={(label) => toast.success(`Guardaste ${label}`)}
        />
      )}
      {dialog?.kind === "restore" && (
        <SourceConnectionDialog
          key={dialog.row.id}
          title="Restaurar cuenta"
          description="Revisá los datos antes de restaurarla."
          submitLabel="Restaurar"
          initial={initialFields(dialog.row, portfolios)}
          holders={holders}
          portfolios={portfolios}
          returnFocusTo={card.focusHeading}
          savedRemovesOpener
          onClose={() => setDialog(null)}
          onSubmit={(fields) => restoreSourceConnection(dialog.row.id, fields)}
          onSaved={(label) => toast.success(`Restauraste ${label}`)}
        />
      )}
    </SetupCard>
  );
}
