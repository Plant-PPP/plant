import { compareDecimals, exactOf, over, stored } from "@plant/shared";

import { averageCost, gainThreshold, withGainFigures } from "@/lib/alerts/gain";
import type { PriceAlert } from "@/lib/alerts/alerts";
import { buildFixtures } from "@/lib/prototype/fixtures";
import { allRows, positionsOf } from "@/lib/ledger/ledger";

import { initialState } from "./prototype-store";

const TODAY = "2026-10-12";
const state = initialState(buildFixtures(TODAY), TODAY);

// An instrument the fixtures hold, in its quote currency.
const heldOne = () => {
  const symbol = allRows(state).find(
    (row) => row.holding.asset_class === "instrument",
  )!.holding.instrument_symbol!;
  const { currency } = state.instruments.find((i) => i.symbol === symbol)!;
  return { symbol, currency: currency as "ARS" | "USD" };
};

const gainAlert = (symbol: string, currency: "ARS" | "USD"): PriceAlert => ({
  id: "g",
  subjectKind: "instrument",
  subject: symbol,
  direction: "above",
  threshold: null,
  currency,
  gainPercent: "20",
  costPrice: null,
  metOn: null,
  metPrice: null,
  seenAt: null,
});

it("moves a cost by a gain's or a loss's percent, exactly", () => {
  expect(gainThreshold("50000", "above", "20")).toBe("60000");
  expect(gainThreshold("50000", "below", "12.5")).toBe("43750");
  expect(gainThreshold("0.3", "above", "10")).toBe("0.33");
});

it("works an instrument's average cost out of its open lots, as Activos does", () => {
  const { symbol, currency } = heldOne();
  const cost = averageCost(state, symbol, currency);
  expect(cost).not.toBeNull();
  // The same figure Activos shows: the open lots' cost over their units.
  const unit = currency === "ARS" ? "ars" : "usd_mep";
  const positions = positionsOf(state, unit);
  const rows = allRows(state).filter(
    (row) => row.holding.instrument_symbol === symbol,
  );
  const held = rows.flatMap((row) => positions.get(row.id) ?? []);
  const total = held.reduce(
    (sum, each) => sum + Number(each.money?.cost ?? 0),
    0,
  );
  const units = held.reduce((sum, each) => sum + Number(each.quantity), 0);
  expect(Number(cost)).toBeCloseTo(total / units, 4);
});

it("fills a waiting gain alert's figure from the ledger, and leaves a met one", () => {
  const { symbol, currency } = heldOne();
  const [waiting, met] = withGainFigures(state, [
    gainAlert(symbol, currency),
    { ...gainAlert(symbol, currency), metOn: TODAY, metPrice: "1" },
  ]);
  const cost = averageCost(state, symbol, currency)!;
  expect(waiting!.costPrice).toBe(cost);
  expect(
    compareDecimals(
      stored(over(exactOf(waiting!.threshold!), exactOf(cost))),
      "1.2",
    ),
  ).toBe(0);
  expect(met!.threshold).toBeNull();
});

it("has no figure for an instrument the user does not hold", () => {
  expect(averageCost(state, "ZZZZ", "USD")).toBeNull();
  const [alert] = withGainFigures(state, [gainAlert("ZZZZ", "USD")]);
  expect(alert!.threshold).toBeNull();
});
