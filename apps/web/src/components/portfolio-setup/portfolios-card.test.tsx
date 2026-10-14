import { renderToStaticMarkup } from "react-dom/server";
import type { ListView, PortfolioRow } from "@/lib/portfolio-setup/read";
import { listView } from "@/test/list-view";
import { applyChange } from "./list-change";
import { PortfoliosCard } from "./portfolios-card";

const unused = () => Promise.reject(new Error("not called"));

function render(change: Partial<ListView<PortfolioRow>> = {}, pending = false) {
  return renderToStaticMarkup(
    <PortfoliosCard
      pending={pending}
      run={() => true}
      view={listView({
        active: [
          { id: "p1", name: "Principal" },
          { id: "p2", name: "Largo plazo" },
        ],
        ...change,
      })}
      actions={{
        create: unused,
        rename: unused,
        archive: unused,
        restore: unused,
      }}
      usedBy={() => []}
    />,
  );
}

it("lists the active rows in a table named after the section", () => {
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
  expect(html).toContain("No tenés carteras activas");
});

it("keeps the add button focusable while a write runs", () => {
  const html = render({}, true);
  expect(html).toMatch(
    /<button[^>]*aria-disabled="true"[^>]*>.*Agregar cartera/,
  );
  expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>.*Agregar cartera/);
});

it("fades a row the server has not confirmed yet", () => {
  const { active } = applyChange(
    listView({ active: [{ id: "p1", name: "Principal" }] }),
    { kind: "create", row: { id: "new-1", name: "Nueva" } },
  );
  const html = render({ active });
  expect(html).toMatch(
    /<tr[^>]*class="[^"]*opacity-60[^"]*"[^>]*data-row-id="new-1"[^>]*aria-busy="true"/,
  );
  expect(html).toMatch(/<tr[^>]*class="[^"]*border-b[^"]*" data-row-id="p1">/);
});

it("passes the page's pending to its archived list", () => {
  const paged = {
    archived: [{ id: "p3", name: "Vieja" }],
    archivedFirstHref: "/accounts",
    archivedNextHref: "/accounts?portfolios=x",
  };
  expect(render(paged, true)).toMatch(/<a [^>]*aria-disabled="true"/);
});

it("offers delete only on the rows a delete would go through for", () => {
  const html = renderToStaticMarkup(
    <PortfoliosCard
      pending={false}
      run={() => true}
      view={listView({
        active: [
          { id: "p1", name: "Principal" },
          { id: "p2", name: "Largo plazo" },
        ],
        archived: [
          { id: "p3", name: "Vieja" },
          { id: "p4", name: "Usada" },
        ],
      })}
      actions={{
        create: unused,
        rename: unused,
        archive: unused,
        restore: unused,
        delete: unused,
      }}
      usedBy={() => []}
      deletable={["p2", "p3"]}
    />,
  );
  // An active portfolio's actions sit in its ⋯ menu; an archived one's stay
  // as icons.
  expect(html).toContain('aria-label="Acciones de Largo plazo"');
  expect(html).toContain('aria-label="Borrar Vieja"');
  expect(html).not.toContain('aria-label="Borrar Usada"');
});

it("links each active portfolio's name to its page once the server has it", () => {
  const html = renderToStaticMarkup(
    <PortfoliosCard
      pending={false}
      run={() => true}
      view={listView({
        active: [
          { id: "p1", name: "Principal" },
          { id: "new-1", name: "Nueva" },
        ],
        archived: [{ id: "p3", name: "Vieja" }],
      })}
      href={(id) => `/portfolios/${id}`}
      actions={{
        create: unused,
        rename: unused,
        archive: unused,
        restore: unused,
      }}
      usedBy={() => []}
    />,
  );
  expect(html).toMatch(/<a[^>]*href="\/portfolios\/p1"[^>]*>Principal<\/a>/);
  expect(html).not.toContain('href="/portfolios/new-1"');
  expect(html).not.toContain('href="/portfolios/p3"');
});
