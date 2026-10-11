import { holdingSchema } from "@plant/core";

import { SALES_TABS, TABS } from "./assets-filter";
import { assetsSelection } from "./assets-selection";
import type { HoldingRow } from "./read";

const row = (id: string, portfolioId: string): HoldingRow => ({
  id,
  holding: holdingSchema.parse({
    id,
    portfolio_id: portfolioId,
    asset_class: "cash",
    instrument_symbol: null,
    amount: "1",
    currency: "ARS",
    annual_rate: null,
    started_on: null,
    matures_on: null,
    valued_on: null,
    label: null,
  }),
  account: { id: "a1", institution: "IOL" },
  portfolio: { id: portfolioId, name: portfolioId },
});

const ROWS = [row("h1", "p1"), row("h2", "p2")];

it("keeps the holdings the params' filters match", () => {
  expect(
    assetsSelection({
      params: { portfolio: "p2", tab: "accounts" },
      rows: ROWS,
      portfolioIds: ["p1", "p2"],
      tabs: TABS,
      salesYears: [],
      names: new Map(),
    }),
  ).toMatchObject({
    tab: "accounts",
    filter: { portfolioId: "p2" },
    shown: [ROWS[1]],
  });
});

it("reads the sales tab and year only where the page offers them", () => {
  const options = {
    params: { tab: "sales", year: "2025" },
    rows: ROWS,
    portfolioIds: [],
    names: new Map(),
  };
  expect(
    assetsSelection({
      ...options,
      tabs: SALES_TABS,
      salesYears: ["2026", "2025"],
    }),
  ).toMatchObject({ tab: "sales", year: "2025", shown: ROWS });
  expect(
    assetsSelection({ ...options, tabs: TABS, salesYears: [] }),
  ).toMatchObject({
    tab: "holdings",
    year: null,
    invalid: { tab: true, year: true },
  });
});
