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
  origin: "sheet",
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

it("words the left-out holdings by what the import read", () => {
  const html = (origin: ImportItem["origin"]) =>
    render(undefined, { ...ITEM, origin, skippedRows: 1 });
  expect(html("sheet")).toContain("Una fila de la planilla no se pudo leer");
  expect(html("sync")).not.toContain("planilla");
  expect(html("sync")).toContain("no pudo traer");
  expect(html("document")).not.toContain("planilla");
  expect(html("document")).toContain("quedó afuera");
});

it("takes rows with no asset chosen yet as no repeat", () => {
  const blank = { ...ITEM.rows[0]!, symbol: "" };
  const html = render(undefined, {
    ...ITEM,
    rows: [
      { ...blank, id: "b1" },
      { ...blank, id: "b2" },
    ],
  });
  expect(html).not.toContain("aparece más de una vez");
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

describe("cash", () => {
  const cashRow = (currency: "ARS" | "USD", quantity: string) => ({
    id: `cash-${currency}`,
    assetClass: "cash" as const,
    symbol: currency,
    quantity,
    price: null,
    value: null,
    currency,
    confidence: "high" as const,
    source: "Del documento",
    discarded: false,
  });
  const renderCash = (cash?: Parameters<typeof ImportReview>[0]["cash"]) =>
    renderToStaticMarkup(
      <ImportReview
        item={{
          ...ITEM,
          rows: [cashRow("USD", "812.4"), cashRow("ARS", "1000")],
        }}
        institution="IBKR"
        instruments={[]}
        held={new Map()}
        cash={cash}
        routing={{
          portfolios: [{ id: "p1", name: "Principal" }],
          defaultPortfolioId: "p1",
          elsewhere: new Map(),
        }}
        backHref="/import"
        doneHref="/import"
        actions={{ confirm: async () => ({ ok: true, id: "r1" }) }}
      />,
    );

  it("shows a cash balance by its currency, against the account's cash, with no price", () => {
    const html = renderCash({
      held: new Map([["USD", "500"]]),
      several: new Set(),
    });
    expect(html).toContain("Efectivo USD");
    expect(html).toContain("Efectivo ARS");
    expect(html).toContain("Sube de 500");
    expect(html).toContain("Nueva");
    expect(html).toContain('aria-label="Monto de la fila 1"');
    expect(html).not.toContain("Precio de la fila");
    expect(html).not.toContain("Cartera de la fila");
  });

  it("says a balance listed twice is a repeated balance", () => {
    const html = renderToStaticMarkup(
      <ImportReview
        item={{
          ...ITEM,
          rows: [
            cashRow("USD", "812.4"),
            { ...cashRow("USD", "10"), id: "cash-USD-2" },
          ],
        }}
        institution="IBKR"
        instruments={[]}
        held={new Map()}
        backHref="/import"
        doneHref="/import"
        actions={{ confirm: async () => ({ ok: true, id: "r1" }) }}
      />,
    );
    expect(html).toContain("Este saldo aparece más de una vez");
    expect(html).not.toContain("Este instrumento aparece más de una vez");
  });

  it("asks to set by hand a balance the account holds in several cash holdings", () => {
    const html = renderCash({
      held: new Map([["USD", "500"]]),
      several: new Set(["USD"]),
    });
    expect(html).toContain(
      "Tenés varios saldos en esta moneda en la cuenta: descartá la fila y actualizalos a mano.",
    );
  });
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

it("takes the same instrument routed to two accounts as two holdings", () => {
  const account = (id: string, institution: string) => ({
    id,
    institution,
    held: new Map(),
    defaultPortfolioId: "p1",
    elsewhere: new Map(),
  });
  const row = ITEM.rows[1]!;
  const html = renderToStaticMarkup(
    <ImportReview
      item={{
        ...ITEM,
        rows: [
          { ...row, accountLabel: "Cocos", accountId: "a2" },
          { ...row, id: "other", accountLabel: "Nexo", accountId: "a3" },
        ],
      }}
      institution="Cocos"
      instruments={[
        { symbol: "GD30", name: "Global 2030", currency: "USD", type: "bond" },
      ]}
      held={new Map()}
      accounts={[account("a2", "Cocos"), account("a3", "Nexo")]}
      backHref="/import"
      doneHref="/import"
      actions={{ confirm: async () => ({ ok: true, id: "r1" }) }}
    />,
  );
  expect(html).not.toContain("aparece más de una vez");
});
