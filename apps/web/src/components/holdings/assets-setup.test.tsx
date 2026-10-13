jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

import {
  type Denominator,
  holdingSchema,
  type QuoteSnapshot,
} from "@plant/core";
import { renderToStaticMarkup } from "react-dom/server";

import { type AssetsTab, SALES_TABS, TABS } from "@/lib/holdings/assets-filter";
import type { HoldingRow, InstrumentRow } from "@/lib/holdings/read";
import {
  type HoldingsValuation,
  type Sum,
  holdingsValuation,
} from "@/lib/holdings/valuation-view";

import type { HoldingActions } from "@/lib/holdings/write-actions";

import { AssetsSetup, saveHoldingEdit } from "./assets-setup";
import { initialFields } from "./holding-fields";

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
  instrumentType: null,
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
  instruments: {},
};

const ACCOUNT = {
  id: "a1",
  institution: "IOL",
  includeInTaxReport: true,
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
      filter={{ portfolioId, holdingClass: null, search: "" }}
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
      instruments: {},
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
        crypto: sum("900", true, 1, "90.0"),
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
    {
      ...row("h9", PRINCIPAL, "1"),
      holding: unquoted,
      instrumentType: "crypto" as const,
    },
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
    filter: { portfolioId: null, holdingClass: null, search: "" },
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
    instrumentType: "crypto",
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
    entry_order: 2,
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
  const HREFS = {
    instrument: (symbol: string) => `/assets/${symbol}`,
    account: (id: string) => `/accounts/${id}`,
    portfolio: (id: string) => `/portfolios/${id}`,
  };
  const renderWith = (
    tab: AssetsTab,
    rows: HoldingRow[] = [btc, row("h1", PRINCIPAL, "1000")],
    shown = valuation,
  ) =>
    renderToStaticMarkup(
      <AssetsSetup
        holdings={list(rows)}
        valuation={shown}
        unit="usd_mep"
        referenceUnit="usd_mep"
        filter={{ portfolioId: null, holdingClass: null, search: "" }}
        params={tab === "holdings" ? {} : { tab }}
        accounts={[ACCOUNT]}
        portfolios={[PRINCIPAL]}
        instruments={[]}
        today="2026-10-10"
        tabs={SALES_TABS}
        actions={ACTIONS}
        movements={movements}
        movementActions={{ create: done, update: done }}
        hrefs={HREFS}
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

  it("shows an instrument once across its holdings, linked to its page", () => {
    const binance = { id: "a2", institution: "Binance" };
    const second: HoldingRow = {
      ...btc,
      id: "h8",
      holding: { ...btc.holding, id: "h8", portfolio_id: LARGO.id },
      account: binance,
      portfolio: LARGO,
    };
    const rows = [btc, second, row("h1", PRINCIPAL, "1000")];
    const html = renderWith(
      "holdings",
      rows,
      holdingsValuation({
        holdings: rows,
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
      }),
    );
    expect(html.match(/href="\/assets\/BTC"/g)).toHaveLength(1);
    expect(html).toContain("2 cuentas");
    expect(html).toMatch(/class="sr-only">IOL, Binance</);
    expect(html).toContain("2 carteras");
    expect(html).toMatch(/class="sr-only">Principal, Largo plazo</);
    // Both holdings' units, at 60.000 each.
    expect(html).toContain("US$ 60.000,00");
    // No row opens under itself.
    expect(html).not.toContain("Movimientos de");
    // Its one action adds a movement; a holding of its own keeps Editar.
    expect(html).toContain('aria-label="Agregar movimiento de BTC"');
    expect(html).not.toContain('aria-label="Borrar BTC');
    expect(html).toContain('aria-label="Editar Caja h1 de IOL en Principal"');
  });

  describe("an instrument held twice", () => {
    const second: HoldingRow = {
      ...btc,
      id: "h8",
      holding: { ...btc.holding, id: "h8", portfolio_id: LARGO.id },
      account: { id: "a2", institution: "Binance" },
      portfolio: LARGO,
    };
    // 48.000.000 pesos at 1.200 are US$ 40.000: more than one BTC holding
    // (US$ 30.000), less than both (US$ 60.000).
    const cash = row("h1", PRINCIPAL, "48000000");
    const rows = [btc, second, cash];
    const twice = holdingsValuation({
      holdings: rows,
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
    const valuedAt = (
      holdings: HoldingRow[],
      prices: QuoteSnapshot["prices"],
    ) =>
      holdingsValuation({
        holdings,
        truncated: false,
        snapshot: {
          date: "2026-10-10",
          fx: { mep: { sell: "1200", date: "2026-10-10" } },
          prices,
        },
        unit: "usd_mep",
        referenceDollar: "mep",
      });
    const renderTwice = (
      holdings: HoldingRow[] = rows,
      {
        valuation = twice,
        instruments = [],
      }: { valuation?: HoldingsValuation; instruments?: InstrumentRow[] } = {},
    ) =>
      renderToStaticMarkup(
        <AssetsSetup
          holdings={list(holdings)}
          valuation={valuation}
          unit="usd_mep"
          referenceUnit="usd_mep"
          filter={{ portfolioId: null, holdingClass: null, search: "" }}
          params={{}}
          accounts={[ACCOUNT]}
          portfolios={[PRINCIPAL, LARGO]}
          instruments={instruments}
          today="2026-10-10"
          tabs={SALES_TABS}
          actions={ACTIONS}
          movements={{
            ...movements,
            positions: new Map([
              ...movements.positions,
              [
                "h8",
                {
                  quantity: "0.5",
                  money: {
                    cost: "20000",
                    charges: "0",
                    income: "0",
                    realized: "0",
                  },
                },
              ],
            ]),
          }}
          movementActions={{ create: done, update: done }}
          hrefs={HREFS}
        />,
      );
    const html = renderTwice();

    it("sorts the instrument by the value of all its holdings", () => {
      expect(html.indexOf('href="/assets/BTC"')).toBeLessThan(
        html.indexOf("Caja h1"),
      );
    });

    it("totals the cost of every holding with movements in the footer", () => {
      expect(html).toMatch(/<tfoot[^>]*>.*US\$ 35\.000,00.*<\/tfoot>/);
    });

    it("archives a holding of its own but not an instrument's row", () => {
      expect(html).toContain(
        'aria-label="Archivar Caja h1 de IOL en Principal"',
      );
      expect(html).not.toContain("Archivar BTC");
    });

    it("calculates the instrument's row while a write to any holding of it runs", () => {
      expect(html).not.toContain("Calculando…");
      const unsaved = { ...second, unsaved: true as const };
      expect(renderTwice([btc, unsaved, cash])).toContain("Calculando…");
    });

    it("keeps the instrument's place while a write to a holding of it runs", () => {
      const unsaved = { ...second, unsaved: true as const };
      const saving = renderTwice([btc, unsaved, cash]);
      expect(saving.indexOf('href="/assets/BTC"')).toBeLessThan(
        saving.indexOf("Caja h1"),
      );
    });

    it("names the instrument's movement by its symbol and name", () => {
      const named = renderTwice(rows, {
        instruments: [
          { symbol: "BTC", name: "Bitcoin", currency: "USD", type: "crypto" },
        ],
      });
      expect(named).toContain(
        'aria-label="Agregar movimiento de BTC · Bitcoin"',
      );
    });

    it("counts each holding with no quote in the note, as the total does", () => {
      const unquoted = renderTwice(rows, {
        valuation: valuedAt(rows, {}),
      });
      expect(unquoted).toContain(
        "A 2 tenencias les falta cotización; el total no las incluye.",
      );
    });

    it("takes the footer's gain over the total, rounded once", () => {
      // At 60.000,01 each half BTC rounds to 30.000,01 alone, while both
      // are worth 60.000,01: a gain of 25.000,01 over the cost of 35.000.
      const both = [btc, second];
      const footer = renderTwice(both, {
        valuation: valuedAt(both, {
          BTC: { price: "60000.01", currency: "USD", date: "2026-10-10" },
        }),
      }).match(/<tfoot[^>]*>.*<\/tfoot>/)?.[0];
      expect(footer).toContain("+US$ 25.000,01");
    });
  });

  it("keeps one row per holding without movements", () => {
    const btcAlone = { ...btc };
    const html = render([btcAlone, row("h1", PRINCIPAL, "1000")]);
    expect(html).toContain('aria-label="Editar BTC de IOL en Principal"');
    expect(html).not.toContain("Agregar movimiento de");
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

describe("saving an edit", () => {
  const holding = row("h1", PRINCIPAL, "100");
  const fields = {
    ...initialFields(holding, { accountId: "", portfolioId: "", today: "" }),
    amount: "200",
  };

  it("writes the holding alone on a page without details", async () => {
    const update = jest.fn(done);
    await saveHoldingEdit({ actions: { ...ACTIONS, update } }, holding, fields);
    expect(update).toHaveBeenCalledWith(
      "h1",
      expect.not.objectContaining({ inTaxReport: expect.anything() }),
    );
    expect(update).toHaveBeenCalledWith(
      "h1",
      expect.objectContaining({ amount: "200" }),
    );
  });

  it("writes the holding and the report choice together with details", async () => {
    const update = jest.fn(done);
    const together = jest.fn(done);
    await saveHoldingEdit(
      {
        actions: { ...ACTIONS, update },
        details: {
          originOf: () => ({ kind: "manual" }),
          inTaxReport: () => true,
          actions: { setInTaxReport: done, update: together },
        },
      },
      holding,
      { ...fields, inTaxReport: false },
    );
    expect(update).not.toHaveBeenCalled();
    expect(together).toHaveBeenCalledWith(
      "h1",
      expect.objectContaining({ amount: "200" }),
      false,
    );
    expect(together).toHaveBeenCalledWith(
      "h1",
      expect.not.objectContaining({ inTaxReport: expect.anything() }),
      false,
    );
  });
});

describe("saving an edit that leaves the report switch untouched", () => {
  const gd30: HoldingRow = {
    id: "h7",
    holding: holdingSchema.parse({
      id: "h7",
      portfolio_id: PRINCIPAL.id,
      asset_class: "instrument",
      instrument_symbol: "GD30",
      amount: "10",
      currency: null,
      annual_rate: null,
      started_on: null,
      matures_on: null,
      valued_on: null,
      label: null,
    }),
    account: { id: "a1", institution: "IOL" },
    instrumentType: "bond",
    portfolio: PRINCIPAL,
  };
  const save = async (holding: HoldingRow, saved: boolean) => {
    const together = jest.fn(done);
    const inTaxReport = jest.fn(() => saved);
    const fields = initialFields(holding, {
      accountId: "",
      portfolioId: "",
      today: "",
    });
    expect(fields.inTaxReport).toBeUndefined();
    await saveHoldingEdit(
      {
        actions: ACTIONS,
        details: {
          originOf: () => ({ kind: "manual" }),
          inTaxReport,
          actions: { setInTaxReport: done, update: together },
        },
      },
      holding,
      fields,
    );
    return { together, inTaxReport };
  };

  it.each([true, false])(
    "writes the asset's saved choice (%s) with the holding",
    async (saved) => {
      const { together } = await save(gd30, saved);
      expect(together).toHaveBeenCalledWith("h7", expect.anything(), saved);
    },
  );

  it("asks for an instrument's choice by its asset, not its holding", async () => {
    const { inTaxReport } = await save(gd30, false);
    expect(inTaxReport).toHaveBeenCalledWith("instrument:GD30");
  });

  it("asks for any other holding's choice by the holding", async () => {
    const { together, inTaxReport } = await save(
      row("h1", PRINCIPAL, "100"),
      false,
    );
    expect(inTaxReport).toHaveBeenCalledWith("h1");
    expect(together).toHaveBeenCalledWith("h1", expect.anything(), false);
  });
});
