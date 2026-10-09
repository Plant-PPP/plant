"use client";

import {
  archivePortfolio,
  createPortfolio,
  renamePortfolio,
  restorePortfolio,
} from "@/app/(app)/accounts/actions";
import { PAGE_ROW_LIMIT } from "@/lib/portfolio-setup/limits";
import { WRITE_MESSAGES } from "@/lib/portfolio-setup/messages";
import type { PortfoliosView } from "@/lib/portfolio-setup/read";
import { type NamedRowsCopy, NamedRowsCard } from "./named-rows-card";

const COPY: NamedRowsCopy = {
  title: "Carteras",
  description: "Agrupá tus inversiones como quieras",
  addLabel: "Nueva cartera",
  emptyText: "No tenés carteras activas.",
  archivedLabel: "Archivadas",
  noMoreArchived: "No hay más carteras archivadas.",
  firstPageLabel: "Ver las más recientes",
  truncated: `Mostrando las ${PAGE_ROW_LIMIT} más recientes.`,
  createDialog: {
    title: "Nueva cartera",
    description: "Elegí un nombre para la cartera.",
  },
  renameDialog: {
    title: "Renombrar cartera",
    description: "Elegí el nuevo nombre.",
  },
  restoreDialog: {
    title: "Restaurar cartera",
    description:
      "Ya tenés una cartera activa con ese nombre. Elegí otro para restaurarla.",
  },
};

const ACTIONS = {
  create: createPortfolio,
  rename: renamePortfolio,
  archive: archivePortfolio,
  restore: restorePortfolio,
};

export function PortfoliosCard({
  view,
  usedBy,
}: {
  view: PortfoliosView;
  usedBy: (id: string) => string[];
}) {
  return (
    <NamedRowsCard
      view={view}
      copy={COPY}
      actions={ACTIONS}
      messages={WRITE_MESSAGES.portfolios}
      usedBy={usedBy}
    />
  );
}
