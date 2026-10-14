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
