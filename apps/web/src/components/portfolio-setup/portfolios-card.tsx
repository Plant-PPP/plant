"use client";

import { Archive, ArchiveRestore, Pencil, Plus } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import {
  archivePortfolio,
  createPortfolio,
  renamePortfolio,
  restorePortfolio,
} from "@/app/(app)/accounts/actions";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { FormAlert } from "@/components/ui/form-alert";
import { PAGE_ROW_LIMIT } from "@/lib/portfolio-setup/limits";
import type { PortfolioRow, PortfoliosView } from "@/lib/portfolio-setup/read";
import { rowAnswer } from "./answers";
import { NameSheet } from "./name-sheet";

type SheetState =
  | { kind: "create" }
  | { kind: "rename"; row: PortfolioRow }
  | { kind: "restore"; row: PortfolioRow };

export function PortfoliosCard({ view }: { view: PortfoliosView }) {
  const [sheet, setSheet] = useState<SheetState | null>(null);
  const [alert, setAlert] = useState<string>();
  const [pending, startTransition] = useTransition();
  // Seeded once: paging back to the first archived page keeps it open.
  const [archivedOpen, setArchivedOpen] = useState(
    view.archivedFirstHref !== null,
  );

  function openSheet(next: SheetState) {
    setAlert(undefined);
    setSheet(next);
  }

  function rowAction(row: PortfolioRow, action: "archive" | "restore") {
    setAlert(undefined);
    startTransition(async () => {
      const call =
        action === "archive"
          ? archivePortfolio(row.id)
          : restorePortfolio(row.id);
      const answer = rowAnswer(
        await call.catch(() => "rejected" as const),
        action,
      );
      if (answer.kind === "alert") setAlert(answer.text);
      // Never over a sheet the user opened meanwhile.
      if (answer.kind === "ask_name") {
        setSheet((open) => open ?? { kind: "restore", row });
      }
    });
  }

  return (
    <Card className="max-w-3xl gap-0">
      <CardHeader className="border-b">
        <CardTitle className="text-lg">
          <h2>Carteras</h2>
        </CardTitle>
        <CardDescription>Agrupá tus inversiones como quieras</CardDescription>
        <CardAction>
          <Button
            size="sm"
            disabled={pending}
            onClick={() => openSheet({ kind: "create" })}
          >
            <Plus />
            Nueva cartera
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="grid gap-4 pt-6">
        {alert && <FormAlert>{alert}</FormAlert>}
        <ul className="divide-y rounded-md border">
          {view.active.map((row) => (
            <li
              key={row.id}
              className="flex items-center justify-between gap-2 px-3 py-2"
            >
              <span className="min-w-0 truncate text-sm">{row.name}</span>
              <span className="flex shrink-0 gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={() => openSheet({ kind: "rename", row })}
                  aria-label={`Renombrar ${row.name}`}
                >
                  <Pencil />
                  <span className="sr-only sm:not-sr-only">Renombrar</span>
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={() => rowAction(row, "archive")}
                  aria-label={`Archivar ${row.name}`}
                >
                  <Archive />
                  <span className="sr-only sm:not-sr-only">Archivar</span>
                </Button>
              </span>
            </li>
          ))}
        </ul>
        {view.activeTruncated && (
          <p className="text-xs text-muted-foreground">
            Mostrando las {PAGE_ROW_LIMIT} más recientes.
          </p>
        )}
        {(view.archived.length > 0 || view.archivedFirstHref) && (
          <details
            open={archivedOpen}
            onToggle={(event) => setArchivedOpen(event.currentTarget.open)}
          >
            <summary className="cursor-pointer text-sm font-medium">
              Archivadas
            </summary>
            <ul className="mt-2 divide-y rounded-md border">
              {view.archived.map((row) => (
                <li
                  key={row.id}
                  className="flex items-center justify-between gap-2 px-3 py-2"
                >
                  <span className="min-w-0 truncate text-sm text-muted-foreground">
                    {row.name}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={pending}
                    onClick={() => rowAction(row, "restore")}
                    aria-label={`Restaurar ${row.name}`}
                  >
                    <ArchiveRestore />
                    <span className="sr-only sm:not-sr-only">Restaurar</span>
                  </Button>
                </li>
              ))}
            </ul>
            <div className="mt-2 flex gap-4 text-sm">
              {view.archivedFirstHref && (
                <Link
                  className="underline"
                  href={view.archivedFirstHref}
                  scroll={false}
                >
                  Ver las más recientes
                </Link>
              )}
              {view.archivedNextHref && (
                <Link
                  className="underline"
                  href={view.archivedNextHref}
                  scroll={false}
                >
                  Ver más
                </Link>
              )}
            </div>
          </details>
        )}
      </CardContent>
      {sheet?.kind === "create" && (
        <NameSheet
          onClose={() => setSheet(null)}
          title="Nueva cartera"
          description="Elegí un nombre para la cartera."
          submitLabel="Crear"
          onSubmit={(name) => createPortfolio({ name })}
        />
      )}
      {sheet?.kind === "rename" && (
        <NameSheet
          key={sheet.row.id}
          onClose={() => setSheet(null)}
          title="Renombrar cartera"
          description="Elegí el nuevo nombre."
          submitLabel="Guardar"
          defaultValue={sheet.row.name}
          onSubmit={(name) => renamePortfolio(sheet.row.id, { name })}
        />
      )}
      {sheet?.kind === "restore" && (
        <NameSheet
          key={sheet.row.id}
          onClose={() => setSheet(null)}
          title="Restaurar cartera"
          description="Ya tenés una cartera activa con ese nombre. Elegí otro para restaurarla."
          submitLabel="Restaurar"
          defaultValue={sheet.row.name}
          onSubmit={(name) => restorePortfolio(sheet.row.id, { name })}
        />
      )}
    </Card>
  );
}
