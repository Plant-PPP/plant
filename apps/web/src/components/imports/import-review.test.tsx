jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

import { renderToStaticMarkup } from "react-dom/server";

import type { ImportItem } from "@/lib/imports/review";

import { ImportReview, pickedInstrument } from "./import-review";

const ITEM: ImportItem = {
  id: "r1",
  fileName: "cocos.pdf",
  accountId: "a2",
  status: "ready",
  error: null,
  documentDate: "2026-10-12",
  documentTotals: [],
  skippedRows: 0,
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

const render = (
  routing?: Parameters<typeof ImportReview>[0]["routing"],
  item: ImportItem = ITEM,
) =>
  renderToStaticMarkup(
    <ImportReview
      item={item}
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

it("clears a price and cost printed in another currency when the row's instrument is picked", () => {
  const instruments = [
    { symbol: "AAPL", currency: "ARS" as const },
    { symbol: "BTC", currency: "USD" as const },
  ];
  expect(pickedInstrument("USD", "AAPL", instruments)).toEqual({
    symbol: "AAPL",
    currency: "ARS",
    value: null,
    priceText: "",
    costText: "",
    printsCost: false,
  });
  expect(pickedInstrument("USD", "BTC", instruments)).toEqual({
    symbol: "BTC",
    currency: "USD",
  });
});

it("asks neither on a page that does not route the rows", () => {
  const html = render();
  expect(html).not.toContain("Cartera de la fila");
  expect(html).not.toContain("¿Es un traspaso?");
});

it("says how many holdings of a spreadsheet were left out", () => {
  const html = (skippedRows: number) =>
    render(undefined, { ...ITEM, skippedRows });
  expect(html(0)).not.toContain("no se pud");
  expect(html(1)).toContain("Una fila de la planilla no se pudo leer");
  expect(html(3)).toContain("3 filas de la planilla no se pudieron leer");
});

it("shows the average cost a document printed, for the units to come in at", () => {
  const html = render(undefined, {
    ...ITEM,
    rows: [{ ...ITEM.rows[0]!, cost: "12000" }],
  });
  expect(html).toContain("Costo promedio");
});

it("still asks for the price of units added to a holding already held", () => {
  const html = renderToStaticMarkup(
    <ImportReview
      item={{
        ...ITEM,
        rows: [{ ...ITEM.rows[0]!, symbol: "GD30", price: null, cost: "60" }],
      }}
      institution="Cocos"
      instruments={[
        { symbol: "GD30", name: "Global 2030", currency: "USD", type: "bond" },
      ]}
      held={new Map([["GD30", "1"]])}
      backHref="/import"
      doneHref="/import"
      actions={{ confirm: async () => ({ ok: true, id: "r1" }) }}
    />,
  );
  expect(html).toMatch(
    /aria-label="Precio de la fila 1"[^>]*aria-invalid="true"|aria-invalid="true"[^>]*aria-label="Precio de la fila 1"/,
  );
});

it("asks for the account of a row a document lists under one it cannot name", () => {
  const html = renderToStaticMarkup(
    <ImportReview
      item={{
        ...ITEM,
        rows: [{ ...ITEM.rows[0]!, accountLabel: "BingX" }],
      }}
      institution="Cocos"
      instruments={[
        { symbol: "AAPL", name: "Apple", currency: "ARS", type: "cedear" },
      ]}
      held={new Map()}
      accounts={[
        {
          id: "a2",
          institution: "Cocos",
          held: new Map(),
          defaultPortfolioId: "p1",
          elsewhere: new Map(),
        },
        {
          id: "a3",
          institution: "Nexo",
          held: new Map(),
          defaultPortfolioId: "p1",
          elsewhere: new Map(),
        },
      ]}
      backHref="/import"
      doneHref="/import"
      actions={{ confirm: async () => ({ ok: true, id: "r1" }) }}
    />,
  );
  expect(html).toContain("el documento dice &quot;BingX&quot;");
  expect(html).toContain("Elegí una cuenta");
});
