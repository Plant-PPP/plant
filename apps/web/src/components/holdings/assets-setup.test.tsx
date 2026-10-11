jest.mock("@/app/(app)/assets/actions", () => ({}));
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

import { holdingSchema } from "@plant/core";
import { renderToStaticMarkup } from "react-dom/server";

import type { AssetsTab } from "@/lib/holdings/assets-filter";
import type { HoldingRow } from "@/lib/holdings/read";
import {
  type HoldingsValuation,
  type Sum,
  holdingsValuation,
} from "@/lib/holdings/valuation-view";

import { AssetsSetup } from "./assets-setup";

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
    view = "tenencias",
    valuation = VALUATION,
  }: {
    accounts?: (typeof ACCOUNT)[];
    portfolioId?: string | null;
    view?: AssetsTab;
    valuation?: HoldingsValuation;
  } = {},
) {
  return renderToStaticMarkup(
    <AssetsSetup
      holdings={list(holdings)}
      valuation={valuation}
      unit="ars"
      filter={{ portfolioId, assetClass: null, search: "" }}
      params={view === "tenencias" ? {} : { vista: view }}
      accounts={accounts}
      // Newest first, as the page reads them.
      portfolios={[LARGO, PRINCIPAL]}
      instruments={[]}
      today="2026-10-10"
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
  const accounts = render([row("h1", PRINCIPAL, "1000")], { view: "cuentas" });
  expect(accounts).toMatch(/Valor por cuenta.*IOL.*1 tenencia/);
  expect(accounts).toMatch(/<tfoot[^>]*>.*Total/);
});

it("shows the portfolios tab largest first, with each share", () => {
  const byPortfolio = render(
    [row("h1", PRINCIPAL, "1000"), row("h3", LARGO, "2500.5")],
    { view: "carteras" },
  );
  expect(byPortfolio).toContain("Valor por cartera");
  expect(byPortfolio.indexOf("Largo plazo")).toBeLessThan(
    byPortfolio.indexOf("Principal"),
  );
  expect(byPortfolio).toContain("71,4 %");
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
    /role="tabpanel"[^>]*aria-labelledby="[^"]*-tab-tenencias"/,
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
    { view: "carteras" },
  );
  // Largo plazo is complete itself, but the whole misses a quote.
  expect(byPortfolio).toMatch(/71,4 %<span aria-hidden="true">\*<\/span>/);
});

it("marks the missing-quote note only when the total is marked", () => {
  expect(html).toContain("* A una tenencia le falta cotización");
});

it("shows a share as calculating until the server values its part", () => {
  const fresh = render([row("h1", PRINCIPAL, "1000")], {
    view: "carteras",
    valuation: { ...VALUATION, portfolios: {} },
  });
  expect(fresh.match(/Calculando…/g)).toHaveLength(2);
});
