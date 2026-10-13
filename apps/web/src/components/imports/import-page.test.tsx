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
      actions={{ upload: () => {} }}
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
