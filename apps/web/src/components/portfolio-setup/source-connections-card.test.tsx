jest.mock("@/app/(app)/accounts/actions", () => ({}));

import { renderToStaticMarkup } from "react-dom/server";
import type {
  SourceConnectionRow,
  SourceConnectionsView,
} from "@/lib/portfolio-setup/read";
import { listView } from "@/test/list-view";
import { applyChange } from "./list-change";
import { SourceConnectionsCard } from "./source-connections-card";

const own: SourceConnectionRow = {
  id: "c1",
  institution: "Banco Uno",
  includeInTaxReport: true,
  holder: null,
  portfolio: { id: "p1", name: "Principal", archived: false },
};

const shared: SourceConnectionRow = {
  id: "c2",
  institution: "Broker Dos",
  includeInTaxReport: false,
  holder: { id: "h1", name: "Ana", archived: false },
  portfolio: { id: "p2", name: "Largo plazo", archived: false },
};

function render(change: Partial<SourceConnectionsView> = {}, pending = false) {
  return renderToStaticMarkup(
    <SourceConnectionsCard
      view={listView({ active: [own, shared], ...change })}
      pending={pending}
      run={() => true}
      holders={[]}
      portfolios={[]}
    />,
  );
}

const html = render();

it("names the accounts table", () => {
  expect(html).toMatch(/<caption[^>]*>Cuentas<\/caption>/);
});

it("calls the user's own holder Vos", () => {
  expect(html).toContain('title="Banco Uno · Vos"');
  expect(html).toContain('Banco Uno<span class="@2xl:hidden"> · Vos</span>');
  expect(html).toMatch(/<span class="block truncate" title="Vos">Vos<\/span>/);
});

it("shows the holder, portfolio and report status under the institution", () => {
  expect(html).toContain('title="Broker Dos · Ana"');
  expect(html).toContain(
    'class="block truncate text-xs text-muted-foreground @2xl:hidden" title="Principal · Incluida en el reporte"',
  );
  expect(html).toContain('title="Largo plazo · No incluida en el reporte"');
});

it("heads the account column at every width", () => {
  expect(html).toMatch(/<th(?![^>]*hidden)[^>]*>Cuenta<\/th>/);
});

it("gives the holder, portfolio and report status their own wide columns", () => {
  for (const header of ["Titular", "Cartera", "Reporte"]) {
    expect(html).toMatch(
      new RegExp(
        `<th[^>]*class="[^"]*hidden @2xl:table-cell[^"]*"[^>]*>${header}</th>`,
      ),
    );
  }
  for (const text of ["Ana", "Largo plazo", "Incluida", "No incluida"]) {
    expect(html).toContain(`title="${text}">${text}</span>`);
  }
});

it("names each row's buttons after its account", () => {
  expect(html).toContain('aria-label="Editar tu Banco Uno"');
  expect(html).toContain('aria-label="Archivar Broker Dos de Ana"');
});

it("lists archived accounts in their own table with a restore button", () => {
  const archived = render({ active: [], archived: [shared] });
  expect(archived).toMatch(/<caption[^>]*>Cuentas archivadas<\/caption>/);
  expect(archived).toContain('aria-label="Restaurar Broker Dos de Ana"');
  expect(archived).toContain("Todavía no agregaste cuentas.");
});

it("fades an account the server has not confirmed yet", () => {
  const { active } = applyChange(listView({ active: [shared] }), {
    kind: "create",
    row: own,
  });
  const unsaved = render({ active });
  expect(unsaved).toMatch(
    /<tr[^>]*class="[^"]*opacity-60[^"]*"[^>]*data-row-id="c1"[^>]*aria-busy="true"/,
  );
  expect(unsaved).toMatch(/<tr[^>]*class="border-b" data-row-id="c2">/);
});

it("passes the page's pending to its archived list", () => {
  const paged = {
    archived: [shared],
    archivedFirstHref: "/accounts",
    archivedNextHref: "/accounts?cuentas=x",
  };
  expect(render(paged, true)).toMatch(/<a [^>]*aria-disabled="true"/);
});
