import { renderToStaticMarkup } from "react-dom/server";
import { WRITE_MESSAGES } from "@/lib/portfolio-setup/messages";
import type { ListView, NamedRow } from "@/lib/portfolio-setup/read";
import { listView } from "@/test/list-view";
import { type NamedRowsCopy, NamedRowsCard } from "./named-rows-card";

const dialog = { title: "t", description: "d" };

const copy: NamedRowsCopy = {
  title: "Carteras",
  description: "Agrupá tus inversiones como quieras",
  addLabel: "Nueva cartera",
  emptyText: "No tenés carteras activas.",
  archivedLabel: "Archivadas",
  noMoreArchived: "No hay más carteras archivadas.",
  firstPageLabel: "Ver las más recientes",
  truncated: "Mostrando las más recientes.",
  createDialog: dialog,
  renameDialog: dialog,
  restoreDialog: dialog,
};

const unused = () => Promise.reject(new Error("not called"));

function render(change: Partial<ListView<NamedRow>> = {}) {
  return renderToStaticMarkup(
    <NamedRowsCard
      view={listView({
        active: [
          { id: "p1", name: "Principal" },
          { id: "p2", name: "Largo plazo" },
        ],
        ...change,
      })}
      copy={copy}
      actions={{
        create: unused,
        rename: unused,
        archive: unused,
        restore: unused,
      }}
      messages={WRITE_MESSAGES.portfolios}
      usedBy={() => []}
    />,
  );
}

it("lists the active rows in a table named after the card", () => {
  const html = render();
  expect(html).toMatch(/<caption[^>]*>Carteras<\/caption>/);
  expect(html).toContain('title="Principal">Principal</span>');
  expect(html.indexOf("Principal")).toBeLessThan(html.indexOf("Largo plazo"));
});

it("names each active row's rename and archive buttons after it", () => {
  const html = render();
  for (const label of [
    "Renombrar Principal",
    "Archivar Principal",
    "Renombrar Largo plazo",
    "Archivar Largo plazo",
  ]) {
    expect(html).toContain(`aria-label="${label}"`);
  }
  expect(html).not.toContain('aria-label="Restaurar');
});

it("lists archived rows in their own table with only a restore button", () => {
  const html = render({ active: [], archived: [{ id: "p3", name: "Vieja" }] });
  expect(html).toMatch(/<caption[^>]*>Carteras archivadas<\/caption>/);
  expect(html).toContain('aria-label="Restaurar Vieja"');
  expect(html).not.toContain('aria-label="Archivar Vieja"');
  expect(html).not.toContain('aria-label="Renombrar Vieja"');
  expect(html).toContain("No tenés carteras activas.");
});
