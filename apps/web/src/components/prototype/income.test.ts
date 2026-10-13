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

it("sums what two accounts holding an instrument pay on the same day", () => {
  const apple = state.holdings.find(
    ({ holding }) =>
      holding.asset_class === "instrument" &&
      holding.instrument_symbol === "AAPL",
  )!;
  const twin = { ...apple, holding: { ...apple.holding, id: "twin" } };
  const both = {
    ...state,
    holdings: [...state.holdings, twin],
    movements: new Map([
      ...state.movements,
      [
        "twin",
        (state.movements.get(apple.holding.id) ?? []).map((each) => ({
          ...each,
          id: `twin-${each.id}`,
          holding_id: "twin",
        })),
      ],
    ]),
  };
  const once = calendar.filter(({ name }) => name === "Apple");
  const twice = incomeCalendar(both, snapshot, "usd_mep").filter(
    ({ name }) => name === "Apple",
  );
  expect(twice.map(({ date }) => date)).toEqual(once.map(({ date }) => date));
  expect(Number(twice[0]!.value)).toBeCloseTo(2 * Number(once[0]!.value), 2);
});
