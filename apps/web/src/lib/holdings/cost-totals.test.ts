import type { Position } from "@plant/core";

import { averageOf, costTotals, gainLoss, overExactSum } from "./cost-totals";

const position = (quantity: string, cost: string | null): Position => ({
  quantity,
  money:
    cost === null ? null : { cost, charges: "6", income: "0", realized: "0" },
});

describe("gainLoss", () => {
  it("is the value over cost, in amount and percent", () => {
    expect(gainLoss(position("10", "1500"), "1800")).toEqual({
      amount: "300",
      percent: "20",
    });
    expect(gainLoss(position("10", "1500"), "1200")).toEqual({
      amount: "-300",
      percent: "-20",
    });
  });

  it("has no percent of a zero cost, and is unknown without money or value", () => {
    expect(gainLoss(position("10", "0"), "5")?.percent).toBeNull();
    expect(gainLoss(position("10", null), "5")).toBeNull();
    expect(gainLoss(position("10", "5"), null)).toBeNull();
  });
});

describe("costTotals", () => {
  const items = (
    a: string | null,
    b: string | null,
    bPosition: Position | undefined = position("1", "500"),
  ) => [
    { position: position("10", "1000"), value: a },
    { position: bPosition, value: b },
    { position: undefined, value: "9999" },
  ];

  it("sums the cost, gain and units of the holdings with movements only", () => {
    expect(costTotals(items("1200", "450"))).toEqual({
      count: 2,
      cost: "1500",
      gain: { amount: "150", percent: "10" },
      quantity: "11",
    });
  });

  it("keeps the cost but has no gain when a value is missing", () => {
    expect(costTotals(items("1200", null))).toMatchObject({
      count: 2,
      cost: "1500",
      gain: null,
    });
  });

  it("has neither when a cost cannot be expressed in the unit", () => {
    expect(costTotals(items("1200", "450", position("1", null)))).toMatchObject(
      { count: 2, cost: null, gain: null },
    );
  });

  it("has nothing to show without a holding with movements", () => {
    expect(costTotals([{ position: undefined, value: "10" }])).toEqual({
      count: 0,
      cost: null,
      gain: null,
      quantity: null,
    });
  });
});

it("prices a cost over its units, without fees and taxes, none for no units", () => {
  expect(averageOf("1000", "4")).toBe("250");
  expect(averageOf("0", "0")).toBeNull();
});

describe("overExactSum", () => {
  // Two halves of 1000.01, each rounded up alone to 500.01.
  const halves = costTotals([
    { position: position("0.5", "500"), value: "500.01" },
    { position: position("0.5", "500"), value: "500.01" },
  ]);

  it("takes the gain over the exact sum when every holding has movements", () => {
    expect(halves.gain?.amount).toBe("0.02");
    expect(
      overExactSum(halves, { value: "1000.01", count: 2, missing: 0 }).gain
        ?.amount,
    ).toBe("0.01");
  });

  it("keeps its own gain when a holding has no movements or no quote", () => {
    expect(
      overExactSum(halves, { value: "1000.01", count: 3, missing: 0 }),
    ).toBe(halves);
    expect(
      overExactSum(halves, { value: "500.01", count: 2, missing: 1 }),
    ).toBe(halves);
    expect(overExactSum(halves, undefined)).toBe(halves);
  });
});
