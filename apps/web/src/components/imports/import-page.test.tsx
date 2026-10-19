import { renderToStaticMarkup } from "react-dom/server";

import { ImportPage } from "./import-page";

const ACCOUNT = {
  id: "a1",
  institution: "IOL",
  includeInTaxReport: true,
  portfolio: { id: "p1", name: "Principal", archived: false },
};

const render = (consent?: { accepted: boolean; accept: () => void }) =>
  renderToStaticMarkup(
    <ImportPage
      accounts={[ACCOUNT]}
      archivedAccounts={[]}
      imports={[]}
      used={0}
      reviewHref={(id) => `/import/${id}`}
      actions={{ upload: () => {}, discard: () => {} }}
      consent={consent}
    />,
  );

it("asks for the terms before the first file, with the upload out of reach", () => {
  const html = render({ accepted: false, accept: () => {} });
  expect(html).toContain("Antes de tu primer archivo");
  expect(html).toContain("Guardamos el archivo 30 días y después lo borramos.");
  expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Aceptar y seguir/);
  expect(html).not.toContain("Elegí una cuenta");
});

it("shows the upload once the terms are accepted, or where none are asked", () => {
  for (const html of [render({ accepted: true, accept: () => {} }), render()]) {
    expect(html).not.toContain("Antes de tu primer archivo");
    expect(html).toContain(">Cuenta</label>");
  }
});

it("uploads to no account unless one is chosen, and lists such a file as having none", () => {
  const html = renderToStaticMarkup(
    <ImportPage
      accounts={[ACCOUNT]}
      archivedAccounts={[]}
      imports={[
        {
          id: "i1",
          fileName: "tarjeta.pdf",
          accountId: null,
          status: "ready",
          error: null,
          documentDate: null,
          documentTotals: [],
          rows: [],
          skippedRows: 0,
          origin: "document",
          createdOn: "2026-10-14",
        },
      ]}
      used={0}
      reviewHref={(id) => `/import/${id}`}
      actions={{ upload: () => {}, discard: () => {} }}
    />,
  );
  expect(html).toMatch(
    /<button(?![^>]*disabled="")[^>]*>(?:<svg.*?<\/svg>)?Elegir archivos/,
  );
  expect(html).toContain(">Sin cuenta</span>");
});
