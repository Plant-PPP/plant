import { renderToStaticMarkup } from "react-dom/server";

import type { ImportDebtRow, ImportItem } from "@/lib/imports/review";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

import { type CardDebt, ImportDebtsReview } from "./import-debts-review";

const debt = (extra: Partial<ImportDebtRow> = {}): ImportDebtRow => ({
  id: "d1",
  label: "Visa",
  lender: "Galicia",
  currency: "ARS",
  balance: "250000.5",
  minimumPayment: "25000",
  dueDate: "2026-10-20",
  confidence: "high",
  source: "Página 1",
  discarded: false,
  ...extra,
});

const item = (debts: ImportDebtRow[]): ImportItem => ({
  id: "i1",
  fileName: "tarjeta.pdf",
  accountId: "a1",
  status: "ready",
  error: null,
  documentDate: null,
  documentTotals: [],
  rows: [],
  debts,
  skippedRows: 0,
  createdOn: "2026-10-14",
});

const render = (debts: ImportDebtRow[], cards: CardDebt[] = []) =>
  renderToStaticMarkup(
    <ImportDebtsReview
      item={item(debts)}
      institution="Galicia"
      cards={cards}
      backHref="/import"
      doneHref="/debts"
      actions={{ confirm: async () => ({ ok: true, id: "i1" }) }}
    />,
  );

const confirmButton = (html: string) =>
  /<button[^>]*>Confirmar deudas<\/button>/.exec(html)![0];

it("shows a complete statement as a new card debt, ready to confirm", () => {
  const html = render([debt()]);
  // A new debt asks for its name.
  expect(html).toContain('aria-label="Nombre de la deuda 1" value="Visa"');
  expect(html).toContain('value="250000,5"');
  expect(confirmButton(html)).not.toContain('disabled=""');
});

it("asks for a balance the readings disagreed on before confirming", () => {
  const html = render([debt({ balance: null, confidence: "low" })]);
  expect(html).toContain("Falta en el documento");
  expect(confirmButton(html)).toContain('disabled=""');
});

it("updates the card debt in the same currency that reads the same", () => {
  const html = render(
    [debt()],
    [{ id: "c1", label: "Visa", lender: null, currency: "ARS" }],
  );
  // Updating one keeps its name: the name is not asked.
  expect(html).not.toContain("Nombre de la deuda 1");
  expect(html).toContain('aria-label="Saldo de la deuda 1"');
});
