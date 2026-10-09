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
import { IconButton } from "@/components/ui/icon-button";
import { PAGE_ROW_LIMIT } from "@/lib/portfolio-setup/limits";
import { WRITE_MESSAGES } from "@/lib/portfolio-setup/messages";
import type {
  HolderRow,
  PortfolioRow,
  SourceConnectionRow,
  SourceConnectionsView,
} from "@/lib/portfolio-setup/read";
import { rowAnswer } from "./answers";
import { ArchivedList, SetupCard, useSetupCard } from "./setup-card";
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
  return row.holder?.name ?? "Vos";
}

function rowLabel(row: SourceConnectionRow): string {
  return `${row.institution} de ${holderName(row)}`;
}

function SourceConnectionSummary({
  row,
  muted = false,
}: {
  row: SourceConnectionRow;
  muted?: boolean;
}) {
  return (
    <span className="grid min-w-0 gap-0.5">
      <span
        className={`truncate text-sm ${muted ? "text-muted-foreground" : ""}`}
      >
        {row.institution} · {holderName(row)}
      </span>
      <span className="truncate text-xs text-muted-foreground">
        {row.portfolio.name}
        {row.includeInTaxReport
          ? " · Incluida en el reporte"
          : " · Fuera del reporte"}
      </span>
    </span>
  );
}

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
      { done: `Archivaste ${rowLabel(row)}` },
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
      {view.active.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Todavía no agregaste cuentas.
        </p>
      ) : (
        <ul className="divide-y rounded-md border">
          {view.active.map((row) => (
            <li
              key={row.id}
              className="flex items-center justify-between gap-2 px-3 py-2"
            >
              <SourceConnectionSummary row={row} />
              <span className="flex shrink-0 gap-1">
                <IconButton
                  icon={Pencil}
                  tooltip="Editar"
                  label={`Editar ${rowLabel(row)}`}
                  pending={card.pending}
                  onClick={() => openDialog({ kind: "edit", row })}
                />
                <IconButton
                  icon={Archive}
                  tooltip="Archivar"
                  label={`Archivar ${rowLabel(row)}`}
                  pending={card.pending}
                  onClick={() => archive(row)}
                />
              </span>
            </li>
          ))}
        </ul>
      )}
      {view.activeTruncated && (
        <p className="text-xs text-muted-foreground">
          Mostrando las {PAGE_ROW_LIMIT} más recientes.
        </p>
      )}
      <ArchivedList
        view={view}
        label="Archivadas"
        emptyText="No hay más cuentas archivadas."
        firstPageLabel="Ver las más recientes"
        renderRow={(row) => (
          <>
            <SourceConnectionSummary row={row} muted />
            <IconButton
              icon={ArchiveRestore}
              tooltip="Restaurar"
              label={`Restaurar ${rowLabel(row)}`}
              pending={card.pending}
              onClick={() => openDialog({ kind: "restore", row })}
            />
          </>
        )}
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
          onSaved={(institution) => toast.success(`Agregaste ${institution}`)}
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
          onSaved={(institution) => toast.success(`Guardaste ${institution}`)}
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
          onClose={() => setDialog(null)}
          onSubmit={(fields) => restoreSourceConnection(dialog.row.id, fields)}
          onSaved={(institution) => toast.success(`Restauraste ${institution}`)}
        />
      )}
    </SetupCard>
  );
}
