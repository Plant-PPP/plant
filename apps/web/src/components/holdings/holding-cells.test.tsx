import { renderToStaticMarkup } from "react-dom/server";

import { AccountsCell, ImportOrigin, PortfoliosCell } from "./holding-cells";

it("shows the first two of several accounts and how many, naming every one", () => {
  const html = renderToStaticMarkup(
    <AccountsCell
      accounts={[
        { id: "a1", institution: "Alfa" },
        { id: "a2", institution: "Beta" },
        { id: "a3", institution: "Gamma" },
      ]}
    />,
  );
  expect(html).toContain(">A<");
  expect(html).toContain(">B<");
  expect(html).not.toContain(">G<");
  expect(html).toContain(">3 cuentas<");
  expect(html).toContain('title="Alfa, Beta, Gamma"');
  expect(html).toMatch(/class="sr-only">Alfa, Beta, Gamma</);
});

it("shows how many of several portfolios, naming every one", () => {
  const html = renderToStaticMarkup(
    <PortfoliosCell
      portfolios={[
        { id: "p1", name: "Principal" },
        { id: "p2", name: "Largo plazo" },
      ]}
    />,
  );
  expect(html).toContain(">2 carteras<");
  expect(html).toContain('title="Principal, Largo plazo"');
  expect(html).toMatch(/class="sr-only">Principal, Largo plazo</);
});

it("links an imported holding's origin to the imports, titled by it", () => {
  expect(
    renderToStaticMarkup(
      <ImportOrigin
        origin={{ kind: "import", fileName: "iol.pdf", date: "2026-10-01" }}
        className="underline"
      />,
    ),
  ).toBe(
    '<a title="Importada de iol.pdf el 01/10/2026" class="underline" href="/import">Importada de iol.pdf el 01/10/2026</a>',
  );
});
