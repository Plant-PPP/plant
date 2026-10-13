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
  currency: "ARS" | "USD",
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
  },
  prices: {},
};

const ROWS = [
  cash("h1", PRINCIPAL, "ARS", "1000"),
  cash("h2", LARGO, "USD", "3"),
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
      closeHref={(period) => `/closes/${period}`}
      yearHref={(year) => `/closes/${year}`}
    />,
  );
};

describe("every portfolio", () => {
  const html = render(null);

  it("splits the assets by portfolio, account and currency", () => {
    for (const heading of ["Por cartera", "Por cuenta", "Por moneda"]) {
      expect(html).toContain(`>${heading}</h2>`);
    }
    expect(html).toContain("Largo plazo");
    expect(html).toContain("Galicia");
    expect(html).toContain("En pesos");
    expect(html).toContain("En dólares");
  });

  it("offers the closes, which are of the whole", () => {
    expect(html).toContain(">Cierres</h2>");
  });
});

describe("one portfolio", () => {
  const html = render(PRINCIPAL);

  it("shows its assets today and says why the net worth is not there", () => {
    expect(html).toContain("Los activos de Principal hoy");
    expect(html).toContain("las deudas no son de ninguna");
    expect(html).not.toContain(">Cierres</h2>");
    expect(html).not.toContain(">Por cartera</h2>");
  });

  it("keeps only its holdings in the splits", () => {
    expect(html).toContain("IOL");
    expect(html).not.toContain("Galicia");
    expect(html).not.toContain("En dólares");
  });
});

it("notes the BCRA's restriction only where the page is in MEP dollars", () => {
  expect(render(null, "usd_mep")).toContain("Com. A 8336");
  expect(render(null, "ars")).not.toContain("Com. A 8336");
});
