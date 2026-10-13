import { buildFixtures } from "@/lib/prototype/fixtures";

import { homeUnit, initialState, setPreferences } from "./prototype-store";

const TODAY = "2026-10-12";
const state = initialState(buildFixtures(TODAY), TODAY);

it("opens the pages in the reference dollar until the user picks a unit", () => {
  expect(state.preferredUnit).toBeNull();
  expect(homeUnit({ ...state, referenceDollar: "ccl" })).toBe("usd_ccl");
});

it("opens them in the unit the user picked, whatever the reference dollar", () => {
  const { state: next, result } = setPreferences(state, {
    referenceDollar: "ccl",
    preferredUnit: "ars",
  });
  expect(result.ok).toBe(true);
  expect(next.referenceDollar).toBe("ccl");
  expect(homeUnit(next)).toBe("ars");
  expect(next.holdings).toBe(state.holdings);
});
