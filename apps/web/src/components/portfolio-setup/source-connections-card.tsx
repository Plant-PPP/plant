"use client";

import { Archive, ArchiveRestore, Pencil } from "lucide-react";
import { useState } from "react";
import {
  archiveSourceConnection,
  createSourceConnection,
  restoreSourceConnection,
  updateSourceConnection,
} from "@/app/(app)/accounts/actions";
import { PAGE_ROW_LIMIT } from "@/lib/portfolio-setup/limits";
import { WRITE_MESSAGES } from "@/lib/portfolio-setup/messages";
import type {
  HolderRow,
  PortfolioRow,
  SourceConnectionRow,
  SourceConnectionsView,
} from "@/lib/portfolio-setup/read";
import { rowAnswer } from "./answers";
import { ArchivedList, RowButton, SetupCard, useSetupCard } from "./setup-card";
import {
  SourceConnectionSheet,
  initialFields,
} from "./source-connection-sheet";

const MESSAGES = WRITE_MESSAGES.source_connections;

type SheetState =
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
  const card = useSetupCard(view.archivedPage);
  const [sheet, setSheet] = useState<SheetState | null>(null);

  function openSheet(next: SheetState) {
    if (card.pending) return;
    card.clearMessages();
    setSheet(next);
  }

  function archive(row: SourceConnectionRow) {
    card.rowAction(
      () => archiveSourceConnection(row.id),
      (result) => rowAnswer(result, "archive", MESSAGES),
      { done: `Archivaste ${rowLabel(row)}.` },
    );
  }

  return (
    <SetupCard
      heading={card.heading}
      alert={card.alert}
      notice={card.notice}
      pending={card.pending}
      title="Cuentas"
      description="Dónde tenés tus inversiones, y de quién son"
      addLabel="Agregar cuenta"
      onAdd={() => openSheet({ kind: "create" })}
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
                <RowButton
                  pending={card.pending}
                  icon={<Pencil />}
                  label="Editar"
                  rowName={rowLabel(row)}
                  onClick={() => openSheet({ kind: "edit", row })}
                />
                <RowButton
                  pending={card.pending}
                  icon={<Archive />}
                  label="Archivar"
                  rowName={rowLabel(row)}
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
            <RowButton
              pending={card.pending}
              icon={<ArchiveRestore />}
              label="Restaurar"
              rowName={rowLabel(row)}
              onClick={() => openSheet({ kind: "restore", row })}
            />
          </>
        )}
      />
      {sheet?.kind === "create" && (
        <SourceConnectionSheet
          title="Agregar cuenta"
          description="Contanos dónde tenés inversiones."
          submitLabel="Agregar"
          initial={initialFields(null, portfolios)}
          holders={holders}
          portfolios={portfolios}
          returnFocusTo={card.focusHeading}
          onClose={() => setSheet(null)}
          onSubmit={(fields) => createSourceConnection(fields)}
          onSaved={(institution) => card.setNotice(`Agregaste ${institution}.`)}
        />
      )}
      {sheet?.kind === "edit" && (
        <SourceConnectionSheet
          key={sheet.row.id}
          title="Editar cuenta"
          description="Cambiá los datos de la cuenta."
          submitLabel="Guardar"
          initial={initialFields(sheet.row, portfolios)}
          holders={holders}
          portfolios={portfolios}
          returnFocusTo={card.focusHeading}
          onClose={() => setSheet(null)}
          onSubmit={(fields) => updateSourceConnection(sheet.row.id, fields)}
          onSaved={(institution) => card.setNotice(`Guardaste ${institution}.`)}
        />
      )}
      {sheet?.kind === "restore" && (
        <SourceConnectionSheet
          key={sheet.row.id}
          title="Restaurar cuenta"
          description="Revisá los datos antes de restaurarla."
          submitLabel="Restaurar"
          initial={initialFields(sheet.row, portfolios)}
          holders={holders}
          portfolios={portfolios}
          returnFocusTo={card.focusHeading}
          onClose={() => setSheet(null)}
          onSubmit={(fields) => restoreSourceConnection(sheet.row.id, fields)}
          onSaved={(institution) =>
            card.setNotice(`Restauraste ${institution}.`)
          }
        />
      )}
    </SetupCard>
  );
}
