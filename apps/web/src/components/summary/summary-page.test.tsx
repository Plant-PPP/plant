jest.mock("next/navigation", () => ({
  useRouter: () => ({ replace: jest.fn() }),
}));

import { holdingSchema, type QuoteSnapshot } from "@plant/core";
import { renderToStaticMarkup } from "react-dom/server";

import type { HoldingRow } from "@/lib/holdings/read";
import { holdingsValuation } from "@/lib/holdings/valuation-view";

import { SummaryPage } from "./summary-page";

const PRINCIPAL = { id: "p1", name: "Principal" };
const LARGO = { id: "p2", name: "Largo plazo" };

const cash = (
  id: string,
  portfolio: { id: string; name: string },
  currency: "ARS" | "USD" | "EUR",
  amount: string,
): HoldingRow => ({
  id,
  holding: holdingSchema.parse({
    id,
    portfolio_id: portfolio.id,
    asset_class: "cash",
    instrument_symbol: null,
    amount,
    currency,
    annual_rate: null,
    started_on: null,
    matures_on: null,
    valued_on: null,
    label: null,
  }),
  account: { id: `a-${id}`, institution: id === "h1" ? "IOL" : "Galicia" },
  portfolio,
  instrumentType: null,
});

const SNAPSHOT: QuoteSnapshot = {
  date: "2026-10-12",
  fx: {
    mep: { sell: "1000", date: "2026-10-12" },
    ccl: { sell: "1000", date: "2026-10-12" },
    official: { sell: "1000", date: "2026-10-12" },
    eur: { sell: "1100", date: "2026-10-12" },
  },
  prices: {},
};

const ROWS = [
  cash("h1", PRINCIPAL, "ARS", "1000"),
  cash("h2", LARGO, "USD", "3"),
  cash("h3", LARGO, "EUR", "50"),
];

const render = (
  portfolio: { id: string; name: string } | null,
  unit: "ars" | "usd_mep" = "ars",
) => {
  const rows = ROWS.filter(
    (row) => portfolio === null || row.portfolio.id === portfolio.id,
  );
  return renderToStaticMarkup(
    <SummaryPage
      closes={[]}
      years={[]}
      year={undefined}
      rows={rows}
      valuation={holdingsValuation({
        holdings: rows,
        truncated: false,
        snapshot: SNAPSHOT,
        unit,
        referenceDollar: "mep",
        currencyOf: (holding) => holding.currency!,
      })}
      portfolios={[PRINCIPAL, LARGO]}
      portfolio={portfolio}
      unit={unit}
      referenceUnit="usd_mep"
      params={{}}
      closesQuery=""
    />,
  );
};

describe("every portfolio", () => {
  const html = render(null);

  it("splits the assets by portfolio, account and currency", () => {
    for (const view of ["Por cartera", "Por cuenta", "Por moneda"]) {
      expect(html).toContain(`aria-label="${view}"`);
    }
    expect(html).toContain("Largo plazo");
    expect(html).toContain("Galicia");
    expect(html).toContain("En pesos");
    expect(html).toContain("En dólares");
  });

  it("values euros held at the official euro, in their own line", () => {
    expect(html).toContain("En euros");
    // 50 euros at 1100.
    expect(html).toContain("$ 55.000,00");
  });

  it("offers the closes, which are of the whole", () => {
    expect(html).toContain(">Cierres</h2>");
  });
});

describe("one portfolio", () => {
  const html = render(PRINCIPAL);

  it("shows its assets today and says why the net worth is not there", () => {
    expect(html).toContain("las deudas no son de ninguna");
    expect(html).not.toContain(">Cierres</h2>");
    expect(html).not.toContain('aria-label="Por cartera"');
  });

  it("keeps only its holdings in the splits", () => {
    expect(html).toContain("IOL");
    expect(html).not.toContain("Galicia");
    expect(html).not.toContain("En dólares");
  });
});

it("asks for a first upload when there is nothing yet", () => {
  const html = renderToStaticMarkup(
    <SummaryPage
      closes={[]}
      years={[]}
      year={undefined}
      rows={[]}
      valuation={holdingsValuation({
        holdings: [],
        truncated: false,
        snapshot: SNAPSHOT,
        unit: "ars",
        referenceDollar: "mep",
        currencyOf: (holding) => holding.currency!,
      })}
      portfolios={[]}
      portfolio={null}
      unit="ars"
      referenceUnit="usd_mep"
      params={{}}
      closesQuery=""
    />,
  );
  expect(html).toContain('data-slot="empty-state"');
  expect(html).toContain('href="/import"');
  expect(html).not.toContain("Cómo está repartido");
});
