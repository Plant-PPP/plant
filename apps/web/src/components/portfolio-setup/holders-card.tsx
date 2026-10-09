"use client";

import {
  archiveHolder,
  createHolder,
  renameHolder,
  restoreHolder,
} from "@/app/(app)/accounts/actions";
import { PAGE_ROW_LIMIT } from "@/lib/portfolio-setup/limits";
import { WRITE_MESSAGES } from "@/lib/portfolio-setup/messages";
import type { HoldersView } from "@/lib/portfolio-setup/read";
import { type NamedRowsCopy, NamedRowsCard } from "./named-rows-card";

const COPY: NamedRowsCopy = {
  title: "Titulares",
  description: "Las personas cuyas inversiones seguís además de las tuyas",
  addLabel: "Nuevo titular",
  emptyText:
    "Todavía no agregaste titulares. Las cuentas sin titular son tuyas.",
  archivedLabel: "Archivados",
  noMoreArchived: "No hay más titulares archivados.",
  firstPageLabel: "Ver los más recientes",
  truncated: `Mostrando los ${PAGE_ROW_LIMIT} más recientes.`,
  createDialog: {
    title: "Nuevo titular",
    description: "Escribí el nombre de la persona.",
  },
  renameDialog: {
    title: "Renombrar titular",
    description: "Elegí el nuevo nombre.",
  },
  restoreDialog: {
    title: "Restaurar titular",
    description:
      "Ya tenés un titular activo con ese nombre. Elegí otro para restaurarlo.",
  },
};

const ACTIONS = {
  create: createHolder,
  rename: renameHolder,
  archive: archiveHolder,
  restore: restoreHolder,
};

export function HoldersCard({
  view,
  usedBy,
}: {
  view: HoldersView;
  usedBy: (id: string) => string[];
}) {
  return (
    <NamedRowsCard
      view={view}
      copy={COPY}
      actions={ACTIONS}
      messages={WRITE_MESSAGES.holders}
      usedBy={usedBy}
    />
  );
}
