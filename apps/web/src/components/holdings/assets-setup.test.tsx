jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

import { type Denominator, holdingSchema } from "@plant/core";
import { renderToStaticMarkup } from "react-dom/server";

import { type AssetsTab, SALES_TABS, TABS } from "@/lib/holdings/assets-filter";
import type { HoldingRow } from "@/lib/holdings/read";
import {
  type HoldingsValuation,
  type Sum,
  holdingsValuation,
} from "@/lib/holdings/valuation-view";

import { AssetsSetup, type HoldingActions } from "./assets-setup";

const done = async () => ({ ok: true as const, id: "x" });
const ACTIONS: HoldingActions = {
  create: done,
  update: done,
  archiving: { archive: done, restore: done },
};

const PRINCIPAL = { id: "p1", name: "Principal" };
const LARGO = { id: "p2", name: "Largo plazo" };

const row = (
  id: string,
  portfolio: { id: string; name: string },
  amount: string,
): HoldingRow => ({
  id,
  holding: holdingSchema.parse({
    id,
    portfolio_id: portfolio.id,
    asset_class: "cash",
    instrument_symbol: null,
    amount,
    currency: "ARS",
    annual_rate: null,
    started_on: null,
    matures_on: null,
    valued_on: null,
    label: `Caja ${id}`,
  }),
  account: { id: "a1", institution: "IOL" },
  portfolio,
});

const list = (active: HoldingRow[], activeTruncated = false) => ({
  active,
  activeTruncated,
  archived: [],
  archivedPage: null,
  archivedFirstHref: null,
  archivedNextHref: null,
});

const sum = (
  value: string,
  complete: boolean,
  count: number,
  share: string | null = null,
  missing = 0,
): Sum => ({ value, complete, count, missing, share });
const NONE = sum("0", true, 0);
const TOTAL = sum("3500.5", false, 3, "100.0", 1);
const KINDS = { cash: TOTAL, investments: NONE, other: NONE, total: TOTAL };

const VALUATION: HoldingsValuation = {
  values: {
    h1: {
      id: "h1",
      value: "1000",
      asOf: "2026-10-10",
      price: "1",
      share: "28.6",
    },
    h2: {
      id: "h2",
      value: null,
      asOf: null,
      missing: "price",
      price: null,
      share: null,
    },
    h3: {
      id: "h3",
      value: "2500.5",
      asOf: "2026-10-10",
      price: "1",
      share: "71.4",
    },
  },
  portfolios: {
    p1: sum("1000", false, 2, "28.6", 1),
    p2: sum("2500.5", true, 1, "71.4"),
  },
  accounts: { a1: KINDS },
  kinds: KINDS,
  classes: { cash: TOTAL },
};

const ACCOUNT = {
  id: "a1",
  institution: "IOL",
  includeInTaxReport: true,
  holder: null,
  portfolio: { ...PRINCIPAL, archived: false },
};

function render(
  holdings: HoldingRow[],
  {
    accounts = [ACCOUNT],
    portfolioId = null,
    tab = "holdings",
    valuation = VALUATION,
    referenceUnit = "ars",
    urlUnit,
    actions = ACTIONS,
  }: {
    accounts?: (typeof ACCOUNT)[];
    portfolioId?: string | null;
    tab?: AssetsTab;
    valuation?: HoldingsValuation;
    referenceUnit?: Denominator;
    urlUnit?: Denominator;
    actions?: HoldingActions;
  } = {},
) {
  return renderToStaticMarkup(
    <AssetsSetup
      holdings={list(holdings)}
      valuation={valuation}
      unit="ars"
      referenceUnit={referenceUnit}
      filter={{ portfolioId, assetClass: null, search: "" }}
      params={{
        ...(tab === "holdings" ? {} : { tab }),
        ...(urlUnit ? { unit: urlUnit } : {}),
      }}
      accounts={accounts}
      // Newest first, as the page reads them.
      portfolios={[LARGO, PRINCIPAL]}
      instruments={[]}
      today="2026-10-10"
      tabs={TABS}
      actions={actions}
    />,
  );
}

const html = render([
  row("h1", PRINCIPAL, "1000"),
  row("h2", PRINCIPAL, "5"),
  row("h3", LARGO, "2500.5"),
]);

it("lists the holdings in one table, largest first, with the total", () => {
  expect(html.match(/<table/g)).toHaveLength(1);
  expect(html.indexOf("Caja h3")).toBeLessThan(html.indexOf("Caja h1"));
  // The holding with no quote goes last.
  expect(html.indexOf("Caja h1")).toBeLessThan(html.indexOf("Caja h2"));
  expect(html).toContain("$ 1.000,00");
  expect(html).toMatch(/<tfoot[^>]*>.*Total.*\$ 3\.500,50/);
});

it("offers the three tabs with how many rows each shows", () => {
  expect(html).toMatch(
    /role="tab"[^>]*aria-selected="true"[^>]*>Tenencias <span[^>]*>3</,
  );
  expect(html).toMatch(/>Cuentas <span[^>]*>1</);
  expect(html).toMatch(/>Carteras <span[^>]*>2</);
});

it("dates each value by the quotes it used", () => {
  expect(html).toContain('title="Al 10/10/2026"');
});

it("says which holding has no quote and that the total leaves it out", () => {
  expect(html).toContain("Sin cotización");
  expect(html).toContain(
    "A una tenencia le falta cotización; el total no la incluye.",
  );
});

it("names each holding in its actions", () => {
  expect(html).toContain('aria-label="Editar Caja h1 de IOL en Principal"');
});

it("says when there are no holdings", () => {
  expect(render([])).toContain("Todavía no cargaste tenencias.");
});

it("links to the accounts when there is none to hold anything", () => {
  expect(render([], { accounts: [] })).toMatch(
    /primero agregá una cuenta en <a[^>]*href="\/accounts"[^>]*>Cuentas<\/a>/,
  );
});

it("says no holding matches the filters", () => {
  expect(render([row("h3", LARGO, "1")], { portfolioId: "p1" })).toContain(
    "Ninguna tenencia coincide con los filtros.",
  );
});

it("sums the total and each kind on top, with its share", () => {
  expect(html).toMatch(/<dt[^>]*>Total<\/dt><dd[^>]*><span[^>]*>\$ 3\.500,50/);
  expect(html).toContain("Valuado en pesos · 1 sin cotización");
  expect(html).toMatch(/<dt[^>]*>Efectivo<\/dt>.*100,0 %/);
  expect(html).toMatch(
    /<dt[^>]*>Inversiones<\/dt><dd[^>]*><span[^>]*><span aria-hidden="true"[^>]*>—/,
  );
});

it("splits the whole by class in a bar", () => {
  expect(html).toMatch(/<figcaption.*Efectivo.*100,0 %.*<\/figcaption>/);
});

it("prices each instrument or currency and gives its share", () => {
  expect(html).toContain("$ 1,00");
  expect(html).toContain("28,6 %");
});

it("shows the accounts tab as one table of accounts", () => {
  const accounts = render([row("h1", PRINCIPAL, "1000")], { tab: "accounts" });
  expect(accounts).toMatch(/Valor por cuenta.*IOL.*1 tenencia/);
  expect(accounts).toMatch(/<tfoot[^>]*>.*Total/);
  expect(accounts).toMatch(/role="tab"[^>]*aria-selected="true"[^>]*>Cuentas /);
  expect(accounts).toMatch(
    /role="tabpanel"[^>]*aria-labelledby="[^"]*-tab-accounts"/,
  );
});

it("shows the portfolios tab largest first, with each share", () => {
  const byPortfolio = render(
    [row("h1", PRINCIPAL, "1000"), row("h3", LARGO, "2500.5")],
    { tab: "portfolios" },
  );
  expect(byPortfolio).toContain("Valor por cartera");
  expect(byPortfolio.indexOf("Largo plazo")).toBeLessThan(
    byPortfolio.indexOf("Principal"),
  );
  expect(byPortfolio).toContain("71,4 %");
  expect(byPortfolio).toMatch(
    /role="tab"[^>]*aria-selected="true"[^>]*>Carteras /,
  );
});

it("marks a total that leaves a holding out", () => {
  expect(html).toMatch(/\$ 3\.500,50<span aria-hidden="true">\*<\/span>/);
  expect(html).toContain("(incompleto)");
});

it("says a total with no quoted holding has none, never 0", () => {
  const missing = sum("0", false, 1, null, 1);
  const unquoted = render([row("h2", PRINCIPAL, "5")], {
    valuation: {
      values: {
        h2: {
          id: "h2",
          value: null,
          asOf: null,
          missing: "price",
          price: null,
          share: null,
        },
      },
      portfolios: { p1: missing },
      accounts: { a1: { ...KINDS, total: missing } },
      kinds: { ...KINDS, cash: missing, total: missing },
      classes: { cash: missing },
    },
  });
  expect(unquoted).not.toContain("$ 0,00");
  expect(unquoted).toContain(">A una tenencia le falta cotización");
  expect(unquoted).not.toContain("* A una tenencia");
  // The holding's value and price, the footer, the total card and the cash
  // card.
  expect(unquoted.match(/Sin cotización/g)).toHaveLength(5);
});

it("leaves out of the bar a class with no share, largest share first", () => {
  const barred = render([row("h1", PRINCIPAL, "1000")], {
    valuation: {
      ...VALUATION,
      classes: {
        cash: sum("0", true, 1, "0.0"),
        instrument: sum("900", true, 1, "90.0"),
        real_estate: sum("100", true, 1, "10.0"),
      },
    },
  });
  const caption = barred.match(/<figcaption.*<\/figcaption>/)?.[0] ?? "";
  expect(caption).not.toContain("Efectivo");
  expect(caption.indexOf("Cripto")).toBeLessThan(caption.indexOf("Inmuebles"));
  expect(barred).toContain('style="width:90.0%"');
});

it("puts the panel of the chosen tab under the tabs", () => {
  expect(html).toMatch(
    /role="tabpanel"[^>]*aria-labelledby="[^"]*-tab-holdings"/,
  );
  expect(html).toMatch(/role="tab"[^>]*aria-controls="[^"]*-panel"/);
});

it("shows no share, never 0,0 %, for a kind core could not value", () => {
  const unquoted = holdingSchema.parse({
    id: "h9",
    portfolio_id: PRINCIPAL.id,
    asset_class: "instrument",
    instrument_symbol: "BTC",
    amount: "1",
    currency: null,
    annual_rate: null,
    started_on: null,
    matures_on: null,
    valued_on: null,
    label: null,
  });
  const rows = [
    row("h1", PRINCIPAL, "1000"),
    { ...row("h9", PRINCIPAL, "1"), holding: unquoted },
  ];
  const html = render(rows, {
    valuation: holdingsValuation({
      holdings: rows,
      truncated: false,
      snapshot: { date: "2026-10-10", fx: {}, prices: {} },
      unit: "ars",
      referenceDollar: "mep",
    }),
  });
  expect(html).toMatch(
    /<dt[^>]*>Inversiones<\/dt><dd[^>]*><span[^>]*>Sin cotización<\/span><\/dd><dd[^>]*><span aria-hidden="true"[^>]*>—<\/span><span class="sr-only">Sin porcentaje/,
  );
  expect(html).not.toMatch(/>0,0 %/);
});

it("marks a share when the whole leaves a holding out", () => {
  const byPortfolio = render(
    [row("h1", PRINCIPAL, "1000"), row("h3", LARGO, "2500.5")],
    { tab: "portfolios" },
  );
  // Largo plazo is complete itself, but the whole misses a quote.
  expect(byPortfolio).toMatch(/71,4 %<span aria-hidden="true">\*<\/span>/);
});

it("marks the missing-quote note only when the total is marked", () => {
  expect(html).toContain("* A una tenencia le falta cotización");
});

it("shows a share as calculating until the server values its part", () => {
  const fresh = render([row("h1", PRINCIPAL, "1000")], {
    tab: "portfolios",
    valuation: { ...VALUATION, portfolios: {} },
  });
  expect(fresh.match(/Calculando…/g)).toHaveLength(2);
});

it("shows the reference unit chosen once its param is cleared", () => {
  // The page still values in pesos until the server answers; the choice shows first.
  const cleared = render([], { referenceUnit: "usd_ccl" });
  expect(cleared).toContain("Dólar CCL");
  expect(cleared).not.toContain(">Pesos<");
  expect(render([], { referenceUnit: "usd_ccl", urlUnit: "ars" })).toContain(
    ">Pesos<",
  );
});

it("offers archiving only to a page that passes it", () => {
  const holdings = [row("h1", PRINCIPAL, "1000")];
  expect(render(holdings)).toContain("Archivar ");
  const unarchived = { create: ACTIONS.create, update: ACTIONS.update };
  expect(render(holdings, { actions: unarchived })).not.toContain("Archivar");
});

it("offers the sales tab only with movements", () => {
  const base = {
    holdings: list([]),
    valuation: VALUATION,
    unit: "ars" as const,
    referenceUnit: "ars" as const,
    filter: { portfolioId: null, assetClass: null, search: "" },
    params: {},
    accounts: [ACCOUNT],
    portfolios: [PRINCIPAL],
    instruments: [],
    today: "2026-10-10",
    actions: ACTIONS,
  };
  // @ts-expect-error the sales tab needs movements
  void (<AssetsSetup {...base} tabs={SALES_TABS} />);
  void (<AssetsSetup {...base} tabs={TABS} />);
});

describe("with movements", () => {
  const btc: HoldingRow = {
    id: "h9",
    holding: holdingSchema.parse({
      id: "h9",
      portfolio_id: PRINCIPAL.id,
      asset_class: "instrument",
      instrument_symbol: "BTC",
      amount: "0.5",
      currency: null,
      annual_rate: null,
      started_on: null,
      matures_on: null,
      valued_on: null,
      label: null,
    }),
    account: { id: "a1", institution: "IOL" },
    portfolio: PRINCIPAL,
  };
  const sale = {
    id: "m2",
    holding_id: "h9",
    kind: "sale" as const,
    date: "2026-03-02",
    currency: "USD" as const,
    quantity: "0.5",
    price: "60000",
    charges: [{ kind: "commission" as const, label: null, amount: "4" }],
    reference: null,
    note: null,
    operation_id: "op2",
    rates: {
      mep: { sell: "1200", date: "2026-03-02" },
      ccl: { sell: "1250", date: "2026-03-02" },
      official: { sell: "1000", date: "2026-03-02" },
    },
  };
  const movements = {
    positions: new Map([
      [
        "h9",
        {
          quantity: "0.5",
          money: {
            cost: "15000",
            charges: "9",
            income: "0",
            realized: "14996",
          },
        },
      ],
    ]),
    revisions: new Map([["h9", 2]]),
    sales: {
      rows: [
        {
          operationId: "op2",
          movements: [sale],
          sale: {
            gross: "30000",
            charges: "4",
            cost: "15000",
            result: "14996",
          },
          row: btc,
        },
      ],
      truncated: false,
      totals: { count: 1, gross: "30000", charges: "4", result: "14996" },
    },
    years: ["2026"],
    loadMovements: async () => ({ ok: true as const, rows: [], next: null }),
  };
  const valuation = holdingsValuation({
    holdings: [btc, row("h1", PRINCIPAL, "1000")],
    truncated: false,
    snapshot: {
      date: "2026-10-10",
      fx: { mep: { sell: "1200", date: "2026-10-10" } },
      prices: {
        BTC: { price: "60000", currency: "USD", date: "2026-10-10" },
      },
    },
    unit: "usd_mep",
    referenceDollar: "mep",
  });
  const renderWith = (tab: AssetsTab) =>
    renderToStaticMarkup(
      <AssetsSetup
        holdings={list([btc, row("h1", PRINCIPAL, "1000")])}
        valuation={valuation}
        unit="usd_mep"
        referenceUnit="usd_mep"
        filter={{ portfolioId: null, assetClass: null, search: "" }}
        params={tab === "holdings" ? {} : { tab }}
        accounts={[ACCOUNT]}
        portfolios={[PRINCIPAL]}
        instruments={[]}
        today="2026-10-10"
        tabs={SALES_TABS}
        actions={ACTIONS}
        movements={movements}
        movementActions={{ create: done, update: done }}
      />,
    );

  it("adds cost, average cost and gain, a dash for a holding without movements", () => {
    const html = renderWith("holdings");
    expect(html).toContain(">Costo prom.<");
    expect(html).toContain("US$ 30.000,00");
    expect(html).toContain("+US$ 15.000,00");
    expect(html).toContain("+100,0 %");
    expect(html).toMatch(/Sin movimientos/);
  });

  it("opens an instrument holding into its movements, and offers to add one", () => {
    const html = renderWith("holdings");
    expect(html).toContain(
      'aria-label="Movimientos de BTC de IOL en Principal"',
    );
    expect(html).not.toContain('aria-label="Movimientos de Caja h1');
    expect(html).toContain("Agregar movimiento");
  });

  it("shows the year's sales with their totals and counts them in the tab", () => {
    const html = renderWith("sales");
    expect(html).toMatch(/>Ventas <span[^>]*>1</);
    expect(html).toContain("Operaciones");
    expect(html).toContain("Comisiones e impuestos");
    expect(html).toContain("+US$ 14.996,00");
    expect(html).toMatch(/role="tab"[^>]*aria-selected="true"[^>]*>Ventas /);
  });
});
