import { snapshotOn } from "@plant/core";

import { buildFixtures } from "@/lib/prototype/fixtures";

import { incomeCalendar } from "@/lib/assistant/income";
import { initialState } from "./prototype-store";

const TODAY = "2026-10-12";
const state = initialState(buildFixtures(TODAY), TODAY);
const snapshot = snapshotOn(state.quotes, TODAY, {
  fxKinds: ["mep", "ccl", "official", "uva"],
  symbols: state.instruments.map(({ symbol }) => symbol),
}).snapshot;

const calendar = incomeCalendar(state, snapshot, "usd_mep");

it("lists what comes in over the next 90 days, by date", () => {
  expect(calendar.map(({ date, kind, name }) => [date, kind, name])).toEqual([
    ["2026-10-27", "maturity", "Plazo fijo ARS"],
    ["2026-11-21", "dividend", "Apple"],
    ["2026-11-21", "dividend", "Coca-Cola"],
    ["2026-12-31", "dividend", "SPDR S&P 500"],
  ]);
  expect(calendar.every(({ value }) => value !== null)).toBe(true);
});

it("leaves out a placement that already matured", () => {
  const matured = state.holdings.find(
    ({ holding }) =>
      holding.asset_class === "fixed_term" && holding.matures_on < TODAY,
  );
  expect(matured).toBeDefined();
  expect(calendar.filter(({ kind }) => kind === "maturity")).toHaveLength(1);
});

it("expects nothing once the holdings are closed", () => {
  const closed = {
    ...state,
    holdings: state.holdings.map((each) => ({ ...each, closed: true })),
  };
  expect(incomeCalendar(closed, snapshot, "usd_mep")).toEqual([]);
});
