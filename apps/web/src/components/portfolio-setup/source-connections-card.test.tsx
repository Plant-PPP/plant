import { renderToStaticMarkup } from "react-dom/server";
import type {
  SourceConnectionRow,
  SourceConnectionsView,
} from "@/lib/portfolio-setup/read";
import { listView } from "@/test/list-view";
import { applyChange } from "./list-change";
import { SourceConnectionsCard } from "./source-connections-card";

const first: SourceConnectionRow = {
  id: "c1",
  institution: "Banco Uno",
  includeInTaxReport: true,
  portfolio: { id: "p1", name: "Principal", archived: false },
};

const second: SourceConnectionRow = {
  id: "c2",
  institution: "Broker Dos",
  includeInTaxReport: false,
  portfolio: { id: "p2", name: "Largo plazo", archived: false },
};

function render(change: Partial<SourceConnectionsView> = {}, pending = false) {
  return renderToStaticMarkup(
    <SourceConnectionsCard
      view={listView({ active: [first, second], ...change })}
      pending={pending}
      run={() => true}
      portfolios={[]}
      actions={{
        create: jest.fn(),
        update: jest.fn(),
        archive: jest.fn(),
        restore: jest.fn(),
      }}
    />,
  );
}

const html = render();

it("names the accounts table", () => {
  expect(html).toMatch(/<caption[^>]*>Cuentas<\/caption>/);
});

it("names each account by its institution alone", () => {
  expect(html).toContain('title="Banco Uno">Banco Uno</span>');
  expect(html).toContain('title="Broker Dos">Broker Dos</span>');
});

it("shows the portfolio and report status under the institution", () => {
  expect(html).toContain(
    'class="block truncate pl-6 text-xs text-muted-foreground @2xl:hidden" title="Principal · Incluida en el reporte"',
  );
  expect(html).toContain('title="Largo plazo · No incluida en el reporte"');
});

it("heads the account column at every width", () => {
  expect(html).toMatch(/<th(?![^>]*hidden)[^>]*>Cuenta<\/th>/);
});

it("gives the portfolio and report status their own wide columns", () => {
  for (const header of ["Cartera", "Reporte"]) {
    expect(html).toMatch(
      new RegExp(
        `<th[^>]*class="[^"]*hidden @2xl:table-cell[^"]*"[^>]*>${header}</th>`,
      ),
    );
  }
  for (const text of ["Largo plazo", "Incluida", "No incluida"]) {
    expect(html).toContain(`title="${text}">${text}</span>`);
  }
});

it("names each row's buttons after its account", () => {
  expect(html).toContain('aria-label="Editar Banco Uno"');
  expect(html).toContain('aria-label="Archivar Broker Dos"');
});

it("lists archived accounts in their own table with a restore button", () => {
  const archived = render({ active: [], archived: [second] });
  expect(archived).toMatch(/<caption[^>]*>Cuentas archivadas<\/caption>/);
  expect(archived).toContain('aria-label="Restaurar Broker Dos"');
  expect(archived).toContain("Todavía no agregaste cuentas.");
});

it("fades an account the server has not confirmed yet", () => {
  const { active } = applyChange(listView({ active: [second] }), {
    kind: "create",
    row: first,
  });
  const unsaved = render({ active });
  expect(unsaved).toMatch(
    /<tr[^>]*class="[^"]*opacity-60[^"]*"[^>]*data-row-id="c1"[^>]*aria-busy="true"/,
  );
  expect(unsaved).toMatch(/<tr[^>]*class="border-b" data-row-id="c2">/);
});

it("passes the page's pending to its archived list", () => {
  const paged = {
    archived: [second],
    archivedFirstHref: "/accounts",
    archivedNextHref: "/accounts?accounts=x",
  };
  expect(render(paged, true)).toMatch(/<a [^>]*aria-disabled="true"/);
});

it("offers delete only on the accounts a delete would go through for", () => {
  const markup = renderToStaticMarkup(
    <SourceConnectionsCard
      view={listView({
        active: [first, second],
        archived: [{ ...first, id: "c3", institution: "Vieja" }],
      })}
      pending={false}
      run={() => true}
      portfolios={[]}
      actions={{
        create: jest.fn(),
        update: jest.fn(),
        archive: jest.fn(),
        restore: jest.fn(),
        delete: jest.fn(),
      }}
      deletable={["c2", "c3"]}
    />,
  );
  expect(markup).toContain('aria-label="Borrar Broker Dos"');
  expect(markup).toContain('aria-label="Borrar Vieja"');
  expect(markup).not.toContain('aria-label="Borrar Banco Uno"');
});

it("links each active account's name to its page once the server has it", () => {
  const markup = renderToStaticMarkup(
    <SourceConnectionsCard
      view={listView({
        active: [first, { ...second, id: "new-1" }],
        archived: [{ ...first, id: "c3", institution: "Vieja" }],
      })}
      pending={false}
      run={() => true}
      portfolios={[]}
      href={(id) => `/accounts/${id}`}
      actions={{
        create: jest.fn(),
        update: jest.fn(),
        archive: jest.fn(),
        restore: jest.fn(),
      }}
    />,
  );
  expect(markup).toMatch(/<a[^>]*href="\/accounts\/c1"[^>]*>Banco Uno<\/a>/);
  expect(markup).not.toContain('href="/accounts/new-1"');
  expect(markup).not.toContain('href="/accounts/c3"');
});
