"use client";

import { Archive, ArchiveRestore, Pencil, Plus } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { useEffect, useRef, useState, useTransition } from "react";
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
import { IconButton } from "@/components/ui/icon-button";
import { PAGE_ROW_LIMIT } from "@/lib/portfolio-setup/limits";
import type { PortfolioRow, PortfoliosView } from "@/lib/portfolio-setup/read";
import { settle } from "@/lib/server-action-call";
import { rowAnswer } from "./answers";
import { NameDialog } from "./name-dialog";

type DialogState =
  | { kind: "create" }
  | { kind: "rename"; row: PortfolioRow }
  | { kind: "restore"; row: PortfolioRow };

export function PortfoliosCard({ view }: { view: PortfoliosView }) {
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const archivedSummary = useRef<HTMLElement>(null);
  const paging = useRef(false);
  const focusHeading = () => heading.current;
  const [pending, startTransition] = useTransition();
  // Seeded once: paging back to the first archived page keeps it open.
  const [archivedOpen, setArchivedOpen] = useState(
    view.archivedFirstHref !== null,
  );

  // The page reached through an archived-list link may not have that link,
  // and focus would fall to the page: it goes to the list's summary instead.
  useEffect(() => {
    if (!paging.current) return;
    paging.current = false;
    if (document.activeElement === document.body) {
      archivedSummary.current?.focus();
    }
  }, [view.archivedFirstHref, view.archivedNextHref]);

  function openDialog(next: DialogState) {
    if (pending) return;
    setDialog(next);
  }

  function rowAction(row: PortfolioRow, action: "archive" | "restore") {
    if (pending) return;
    startTransition(async () => {
      const call =
        action === "archive"
          ? archivePortfolio(row.id)
          : restorePortfolio(row.id);
      const answer = rowAnswer(await settle(call), action);
      if (answer.kind === "alert") toast.error(answer.text);
      // A done row moved to the other list, so its button is gone: focus goes
      // to the card's heading instead of falling to the page.
      if (answer.kind === "done") {
        toast.success(
          `${action === "archive" ? "Archivaste" : "Restauraste"} ${row.name}`,
        );
        heading.current?.focus();
      }
      // Defensive: the openers ignore clicks while an action is pending.
      if (answer.kind === "ask_name") {
        setDialog((open) => open ?? { kind: "restore", row });
      }
    });
  }

  return (
    <Card className="max-w-3xl gap-0">
      <CardHeader className="border-b">
        <CardTitle className="text-lg">
          <h2 ref={heading} tabIndex={-1} className="outline-none">
            Carteras
          </h2>
        </CardTitle>
        <CardDescription>Agrupá tus inversiones como quieras</CardDescription>
        <CardAction>
          <Button
            size="sm"
            disabled={pending}
            onClick={() => openDialog({ kind: "create" })}
          >
            <Plus />
            Nueva cartera
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="grid gap-4 pt-6">
        <ul className="divide-y rounded-md border">
          {view.active.map((row) => (
            <li
              key={row.id}
              className="flex items-center justify-between gap-2 px-3 py-2"
            >
              <span className="min-w-0 truncate text-sm">{row.name}</span>
              <span className="flex shrink-0 gap-1">
                <IconButton
                  icon={Pencil}
                  tooltip="Renombrar"
                  label={`Renombrar ${row.name}`}
                  pending={pending}
                  onClick={() => openDialog({ kind: "rename", row })}
                />
                <IconButton
                  icon={Archive}
                  tooltip="Archivar"
                  label={`Archivar ${row.name}`}
                  pending={pending}
                  onClick={() => rowAction(row, "archive")}
                />
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
            <summary
              ref={archivedSummary}
              className="cursor-pointer text-sm font-medium"
            >
              Archivadas
            </summary>
            {view.archived.length === 0 && (
              <p className="mt-2 text-sm text-muted-foreground">
                No hay más carteras archivadas.
              </p>
            )}
            <ul className="mt-2 divide-y rounded-md border empty:hidden">
              {view.archived.map((row) => (
                <li
                  key={row.id}
                  className="flex items-center justify-between gap-2 px-3 py-2"
                >
                  <span className="min-w-0 truncate text-sm text-muted-foreground">
                    {row.name}
                  </span>
                  <IconButton
                    icon={ArchiveRestore}
                    tooltip="Restaurar"
                    label={`Restaurar ${row.name}`}
                    pending={pending}
                    onClick={() => rowAction(row, "restore")}
                  />
                </li>
              ))}
            </ul>
            <div className="mt-2 flex gap-4 text-sm">
              {view.archivedFirstHref && (
                <Link
                  className="underline"
                  href={view.archivedFirstHref}
                  onNavigate={() => (paging.current = true)}
                  scroll={false}
                >
                  Ver las más recientes
                </Link>
              )}
              {view.archivedNextHref && (
                <Link
                  className="underline"
                  href={view.archivedNextHref}
                  onNavigate={() => (paging.current = true)}
                  scroll={false}
                >
                  Ver más
                </Link>
              )}
            </div>
          </details>
        )}
      </CardContent>
      {dialog?.kind === "create" && (
        <NameDialog
          onClose={() => setDialog(null)}
          returnFocusTo={focusHeading}
          title="Nueva cartera"
          description="Elegí un nombre para la cartera."
          submitLabel="Crear"
          onSubmit={(name) => createPortfolio({ name })}
          onSaved={(name) => toast.success(`Creaste ${name}`)}
        />
      )}
      {dialog?.kind === "rename" && (
        <NameDialog
          key={dialog.row.id}
          onClose={() => setDialog(null)}
          returnFocusTo={focusHeading}
          title="Renombrar cartera"
          description="Elegí el nuevo nombre."
          submitLabel="Guardar"
          defaultValue={dialog.row.name}
          onSubmit={(name) => renamePortfolio(dialog.row.id, { name })}
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
          returnFocusTo={focusHeading}
          savedRemovesOpener
          title="Restaurar cartera"
          description="Ya tenés una cartera activa con ese nombre. Elegí otro para restaurarla."
          submitLabel="Restaurar"
          defaultValue={dialog.row.name}
          onSubmit={(name) => restorePortfolio(dialog.row.id, { name })}
          onSaved={(name) => toast.success(`Restauraste ${name}`)}
        />
      )}
    </Card>
  );
}
