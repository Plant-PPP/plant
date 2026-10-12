import type { Position } from "@plant/core";

import { averageCost, costTotals, gainLoss } from "./cost-totals";

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

it("prices one unit held at the cost, without fees and taxes", () => {
  expect(averageCost(position("4", "1000"))).toBe("250");
  expect(averageCost(position("0", "0"))).toBeNull();
  expect(averageCost(position("4", null))).toBeNull();
});

describe("costTotals", () => {
  const positions = new Map([
    ["a", position("10", "1000")],
    ["b", position("1", "500")],
  ]);
  const values = (a: string | null, b: string | null) => ({
    values: {
      a: { value: a },
      b: { value: b },
      cash: { value: "9999" },
    } as never,
  });

  it("sums the cost and gain of the rows with movements only", () => {
    expect(
      costTotals(
        [{ id: "a" }, { id: "b" }, { id: "cash" }],
        positions,
        values("1200", "450"),
      ),
    ).toEqual({
      count: 2,
      cost: "1500",
      gain: { amount: "150", percent: "10" },
    });
  });

  it("keeps the cost but has no gain when a value is missing", () => {
    expect(
      costTotals([{ id: "a" }, { id: "b" }], positions, values("1200", null)),
    ).toEqual({ count: 2, cost: "1500", gain: null });
  });

  it("has neither when a cost cannot be expressed in the unit", () => {
    const unknown = new Map([...positions, ["b", position("1", null)]]);
    expect(
      costTotals([{ id: "a" }, { id: "b" }], unknown, values("1200", "450")),
    ).toEqual({ count: 2, cost: null, gain: null });
  });
});
