import type { ColumnDef } from "@tanstack/react-table";
import { renderToStaticMarkup } from "react-dom/server";
import type { ListView, NamedRow } from "@/lib/portfolio-setup/read";
import { listView } from "@/test/list-view";
import { ActiveList, ArchivedList } from "./setup-card";

const rows: NamedRow[] = [
  { id: "a", name: "Principal" },
  { id: "b", name: "Largo plazo" },
];

const columns: ColumnDef<NamedRow>[] = [
  { id: "name", header: "Nombre", cell: ({ row }) => row.original.name },
];

function active(view: ListView<NamedRow>) {
  return renderToStaticMarkup(
    <ActiveList
      view={view}
      title="Carteras"
      emptyText="No tenés carteras activas."
      truncatedText="Mostrando las 50 más recientes."
      columns={columns}
    />,
  );
}

function archived(view: ListView<NamedRow>, pending = false) {
  return renderToStaticMarkup(
    <ArchivedList
      view={view}
      title="Carteras"
      label="Archivadas"
      emptyText="No hay más carteras archivadas."
      firstPageLabel="Ver las más recientes"
      columns={columns}
      pending={pending}
    />,
  );
}

describe("ActiveList", () => {
  it("says there are no rows instead of drawing an empty table", () => {
    const html = active(listView());
    expect(html).toContain("No tenés carteras activas.");
    expect(html).not.toContain("<table");
  });

  it("draws the rows in a table named after the card", () => {
    const html = active(listView({ active: rows }));
    expect(html).not.toContain("No tenés carteras activas.");
    expect(html).toMatch(/<caption[^>]*>Carteras<\/caption>/);
    expect(html).toContain("Principal");
    expect(html).toContain("Largo plazo");
  });

  it("notes when only the most recent rows are shown", () => {
    expect(active(listView({ active: rows }))).not.toContain(
      "Mostrando las 50 más recientes.",
    );
    expect(active(listView({ active: rows, activeTruncated: true }))).toContain(
      "Mostrando las 50 más recientes.",
    );
  });
});

describe("ArchivedList", () => {
  it("draws nothing when nothing was ever archived", () => {
    expect(archived(listView())).toBe("");
  });

  it("names the archived table after the card and its label", () => {
    const html = archived(listView({ archived: rows }));
    expect(html).toMatch(/<caption[^>]*>Carteras archivadas<\/caption>/);
    expect(html).toContain("Largo plazo");
    expect(html).not.toContain("No hay más carteras archivadas.");
  });

  it("says a later page is empty instead of drawing an empty table", () => {
    const html = archived(
      listView({ archivedPage: "x", archivedFirstHref: "/accounts" }),
    );
    expect(html).toContain("No hay más carteras archivadas.");
    expect(html).not.toContain("<table");
    expect(html).toContain("Ver las más recientes");
  });

  it("holds the archived pages' links while a write runs", () => {
    const paged = listView<NamedRow>({
      archived: rows,
      archivedFirstHref: "/accounts",
      archivedNextHref: "/accounts?carteras=x",
    });
    expect(archived(paged)).not.toMatch(/<a [^>]*aria-disabled=/);
    expect(
      archived(paged, true).match(/<a [^>]*aria-disabled="true"/g),
    ).toHaveLength(2);
  });
});
