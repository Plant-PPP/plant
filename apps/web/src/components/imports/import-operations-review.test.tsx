import { renderToStaticMarkup } from "react-dom/server";

import type { ImportItem, ImportOperationRow } from "@/lib/imports/review";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

import { ImportOperationsReview } from "./import-operations-review";

const operation = (
  extra: Partial<ImportOperationRow> = {},
): ImportOperationRow => ({
  id: "o1",
  date: "2026-09-01",
  kind: "purchase",
  symbol: "AAPL",
  quantity: "5",
  price: "18000",
  amount: null,
  charges: null,
  reference: "123",
  currency: "ARS",
  confidence: "high",
  source: "Página 1",
  discarded: false,
  ...extra,
});

const item = (operations: ImportOperationRow[]): ImportItem => ({
  id: "i1",
  fileName: "comprobante.pdf",
  accountId: "a1",
  status: "ready",
  error: null,
  documentDate: null,
  documentTotals: [],
  rows: [],
  operations,
  skippedRows: 0,
  origin: "document",
  createdOn: "2026-10-12",
});

const render = (operations: ImportOperationRow[]) =>
  renderToStaticMarkup(
    <ImportOperationsReview
      item={item(operations)}
      institution="IOL"
      instruments={[
        { symbol: "AAPL", name: "Apple", currency: "ARS", type: "cedear" },
      ]}
      backHref="/import"
      doneHref="/import"
      actions={{ confirm: async () => ({ ok: true, id: "i1" }) }}
    />,
  );

const confirmButton = (html: string) =>
  /<button[^>]*>Confirmar operaciones<\/button>/.exec(html)![0];

it("lets a complete operation be confirmed", () => {
  const html = render([operation()]);
  expect(html).toContain("Revisá las operaciones que leímos");
  expect(html).toContain("N° 123");
  expect(html).not.toContain("Falta en el documento");
  expect(confirmButton(html)).not.toContain(' disabled=""');
});

it("asks for what the document does not say, and holds the confirm", () => {
  const html = render([
    operation({ symbol: "", source: "El documento no dice qué activo es" }),
    operation({ id: "o2", kind: null, date: null }),
  ]);
  expect(html).toContain("Elegí un activo");
  expect(html).toContain("Elegí el tipo para completar el resto.");
  expect(html.match(/Falta en el documento/g)).toHaveLength(3);
  expect(html).toContain("2 con datos faltantes");
  expect(html).toContain("Completá los datos que faltan para confirmar.");
  expect(confirmButton(html)).toContain(' disabled=""');
});

it("asks an income for its amount", () => {
  const html = render([
    operation({ kind: "dividend", quantity: null, price: null }),
  ]);
  expect(html).toContain("Monto (ARS)");
  expect(html).not.toContain("Cantidad");
  expect(html).toContain("Falta en el documento");
});

it("asks again for charges typed that do not read as a number", () => {
  const html = render([operation({ charges: "abc" })]);
  expect(html).toContain("Ingresá un número válido");
  expect(confirmButton(html)).toContain(' disabled=""');
});

it("says to keep one operation when every one is discarded", () => {
  const html = render([operation({ discarded: true })]);
  expect(html).toContain("Dejá al menos una operación.");
});

it("says an operation already in the account is loaded, set aside", () => {
  const html = render([
    operation({ loaded: true, discarded: true }),
    operation({ id: "o2" }),
  ]);
  expect(html).toContain("Ya está cargada");
  expect(html).toContain("1 ya estaba cargada");
  expect(html).toContain("Recuperar");
});

it("says how many operations the reading left out", () => {
  const html = (skippedRows: number) =>
    renderToStaticMarkup(
      <ImportOperationsReview
        item={{ ...item([operation()]), skippedRows }}
        institution="IOL"
        instruments={[]}
        backHref="/import"
        doneHref="/import"
        actions={{ confirm: async () => ({ ok: true, id: "i1" }) }}
      />,
    );
  expect(html(0)).not.toContain("afuera");
  expect(html(1)).toContain(
    "Una operación quedó afuera: revisala en el broker antes de confirmar.",
  );
  expect(html(3)).toContain(
    "3 operaciones quedaron afuera: revisalas en el broker antes de confirmar.",
  );
});

it("counts the operations it will import, and filters them by kind and asset", () => {
  const html = render([
    operation(),
    operation({ id: "o2", reference: "124", discarded: true }),
  ]);
  expect(html).toContain("1 de 2 para importar");
  expect(html).toContain('aria-label="Mostrar operaciones de tipo"');
  expect(html).toContain(">Incluir las que se ven</button>");
  expect(html).toContain(">Descartar las que se ven</button>");
});

it("filters by asset only when the operations name more than one", () => {
  expect(render([operation()])).not.toContain(
    'aria-label="Mostrar operaciones del activo"',
  );
  expect(
    render([operation(), operation({ id: "o2", symbol: "GGAL" })]),
  ).toContain('aria-label="Mostrar operaciones del activo"');
});

it("never brings back an operation the account holds under its number", () => {
  const locked = render([
    operation({ discarded: true, loaded: true }),
    operation({ id: "o2", reference: "124" }),
  ]);
  expect(locked).toMatch(
    /<button[^>]*disabled=""[^>]*aria-label="Recuperar la operación 1"/,
  );
  const unnumbered = render([
    operation({ reference: null, discarded: true, loaded: true }),
    operation({ id: "o2", reference: "124" }),
  ]);
  expect(unnumbered).not.toMatch(
    /<button[^>]*disabled=""[^>]*aria-label="Recuperar la operación 1"/,
  );
});

it("words what a sync did not bring by the sync, never a document", () => {
  const html = renderToStaticMarkup(
    <ImportOperationsReview
      item={{
        ...item([operation({ price: null, source: "De la sincronización" })]),
        origin: "sync",
        fileName: "Operaciones de IOL",
      }}
      institution="IOL"
      instruments={[
        { symbol: "AAPL", name: "Apple", currency: "ARS", type: "cedear" },
      ]}
      backHref="/import"
      doneHref="/import"
      actions={{ confirm: async () => ({ ok: true, id: "i1" }) }}
    />,
  );
  expect(html).toContain("No vino en la sincronización");
  expect(html).not.toMatch(/documento/);
});

it("asks for figures above 0 when the reading has a 0", () => {
  const trade = render([operation({ quantity: "0", price: "0" })]);
  expect(trade).toContain("Ingresá una cantidad mayor a 0");
  expect(trade).toContain("Ingresá un precio mayor a 0");
  expect(trade).not.toContain("Falta en el documento");
  const income = render([
    operation({ kind: "dividend", quantity: null, price: null, amount: "0" }),
  ]);
  expect(income).toContain("Ingresá un monto mayor a 0");
  expect(income).not.toContain("Falta en el documento");
});
