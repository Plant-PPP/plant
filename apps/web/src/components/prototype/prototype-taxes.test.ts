import { buildFixtures } from "@/lib/prototype/fixtures";
import { leftOutOf, taxReport, taxYears } from "@/lib/taxes/report";

import { initialState } from "./prototype-store";

const TODAY = "2026-10-12";
const state = initialState(buildFixtures(TODAY), TODAY);

it("estimates every year of the prototype's data", () => {
  const years = taxYears(state);
  expect(years).toEqual(["2026", "2025", "2024"]);
  for (const year of years) {
    const report = taxReport(state, {
      year,
      officialBuy: { buy: "1000", date: `${year}-12-30` },
      euroBuy: { buy: "1100", date: `${year}-12-30` },
      leftOut: leftOutOf(state, state.outOfTaxReport),
      isPlazoFijo: () => true,
    });
    expect(report.wealth.lines.length).toBeGreaterThan(0);
  }
  const last = taxReport(state, {
    year: "2025",
    officialBuy: { buy: "1000", date: "2025-12-30" },
    euroBuy: { buy: "1100", date: "2025-12-30" },
    leftOut: leftOutOf(state, state.outOfTaxReport),
    isPlazoFijo: () => true,
  });
  expect(last.gains.groups.length).toBeGreaterThan(0);
  expect(last.wealth.complete).toBe(true);
});
