jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

import { renderToStaticMarkup } from "react-dom/server";

import type { ImportItem } from "@/lib/imports/review";

import { ImportReview } from "./import-review";

const ITEM: ImportItem = {
  id: "r1",
  fileName: "cocos.pdf",
  accountId: "a2",
  status: "ready",
  error: null,
  documentDate: "2026-10-12",
  documentTotals: [],
  createdOn: "2026-10-12",
  rows: [
    {
      id: "new",
      symbol: "AAPL",
      quantity: "2",
      price: "15000",
      currency: "ARS",
      confidence: "high",
      source: "Página 1",
      discarded: false,
    },
    {
      id: "same",
      symbol: "GD30",
      quantity: "10",
      price: "80",
      currency: "USD",
      confidence: "high",
      source: "Página 1",
      discarded: false,
    },
  ],
};

const render = (routing?: Parameters<typeof ImportReview>[0]["routing"]) =>
  renderToStaticMarkup(
    <ImportReview
      item={ITEM}
      institution="Cocos"
      instruments={[
        { symbol: "AAPL", name: "Apple", currency: "ARS", type: "cedear" },
        { symbol: "GD30", name: "Global 2030", currency: "USD", type: "bond" },
      ]}
      held={new Map([["GD30", "10"]])}
      routing={routing}
      backHref="/import"
      doneHref="/import"
      actions={{ confirm: async () => ({ ok: true, id: "r1" }) }}
    />,
  );

it("asks where a new instrument goes, and whether it comes from another account", () => {
  const html = render({
    portfolios: [
      { id: "p1", name: "Principal" },
      { id: "p2", name: "Largo plazo" },
    ],
    defaultPortfolioId: "p2",
    elsewhere: new Map([["AAPL", [{ id: "a1", institution: "IOL" }]]]),
  });
  expect(html).toContain('aria-label="Cartera de la fila 1"');
  expect(html).toContain("Largo plazo");
  expect(html).toContain("Ya tenés AAPL en otra cuenta. ¿Es un traspaso?");
  expect(html).toContain("Compra o saldo propio");
  expect(html).not.toContain('aria-label="Cartera de la fila 2"');
});

it("asks neither on a page that does not route the rows", () => {
  const html = render();
  expect(html).not.toContain("Cartera de la fila");
  expect(html).not.toContain("¿Es un traspaso?");
});
