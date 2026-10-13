import { valueHoldings } from "@plant/core";

import { buildFixtures } from "@/lib/prototype/fixtures";

import {
  deleteRate,
  holdingsView,
  initialState,
  pricedSnapshotOf,
  setRate,
} from "./prototype-store";

const TODAY = "2026-10-12";
const fixtures = buildFixtures(TODAY);
const state = initialState(fixtures, TODAY);
const today = (s: typeof state) =>
  pricedSnapshotOf(s, {
    date: TODAY,
    fx: { mep: { sell: "1200", date: TODAY } },
    prices: {},
  });

it("values with a dollar rate the user states, over the feed's of that day", () => {
  const { state: rated, result } = setRate(state, {
    kind: "mep",
    sell: "1300",
    rate_date: TODAY,
  });
  expect(result).toEqual({ ok: true });
  const priced = today(rated);
  expect(priced.snapshot.fx.mep).toEqual({ sell: "1300", date: TODAY });
  expect(priced.rates.get("mep")).toBe(TODAY);
  const dollars = holdingsView(rated).active.find(
    (row) =>
      row.holding.asset_class === "cash" && row.holding.currency === "USD",
  )!.holding;
  expect(
    valueHoldings([dollars], priced.snapshot, {
      denominator: "ars",
      referenceDollar: "mep",
    }).total,
  ).toBe("3250000");
});

it("goes back to the feed's rate once the user's is deleted", () => {
  const rated = setRate(state, {
    kind: "mep",
    sell: "1300",
    rate_date: TODAY,
  }).state;
  const back = deleteRate(rated, "mep", TODAY);
  expect(back.result).toEqual({ ok: true });
  expect(today(back.state).snapshot.fx.mep?.sell).toBe("1200");
  expect(deleteRate(back.state, "mep", TODAY).result).toEqual({
    ok: false,
    code: "invalid",
  });
});

it("refuses a rate after today, or that is not positive", () => {
  expect(
    setRate(state, { kind: "mep", sell: "1300", rate_date: "2026-10-13" })
      .result,
  ).toEqual({ ok: false, code: "future_date" });
  expect(
    setRate(state, { kind: "mep", sell: "0", rate_date: TODAY }).result,
  ).toEqual({ ok: false, code: "invalid" });
});
