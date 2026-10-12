import { adjustment, trade, yielded } from "./fixtures.test-support";
import type { Movement } from "./movement";
import { periodResult } from "./period";
import { positionOf, replay } from "./replay";
import { cashFlowsOf, returnsOf } from "./returns";

const BOUGHT = trade("purchase", "10", "100", { date: "2026-09-01" });

const flowsOf = (movements: Movement[]) =>
  cashFlowsOf(movements, replay(movements, "usd_mep", "mep"));

describe("replaying a yield", () => {
  it("brings units in at their value, as cost and as income", () => {
    const steps = replay(
      [BOUGHT, yielded("in", "5", "2", { date: "2026-09-10" })],
      "usd_mep",
      "mep",
    );
    expect(positionOf(steps)).toEqual({
      quantity: "15",
      money: { cost: "1010", charges: "0", income: "10", realized: "0" },
    });
    expect(steps[1]!.sale).toBeUndefined();
  });

  it("takes units out with their cost, loses their value and realizes their gain", () => {
    const steps = replay(
      [BOUGHT, yielded("out", "5", "110", { date: "2026-09-10" })],
      "usd_mep",
      "mep",
    );
    expect(positionOf(steps)).toEqual({
      quantity: "5",
      money: { cost: "500", charges: "0", income: "-550", realized: "50" },
    });
    expect(steps[1]!.sale).toBeUndefined();
  });

  it("values a dollar yield at its own date's rate in pesos", () => {
    const steps = replay(
      [BOUGHT, yielded("in", "1", "110", { date: "2026-09-10" })],
      "ars",
      "mep",
    );
    // MEP 1200 on both dates.
    expect(positionOf(steps).money).toMatchObject({
      cost: "1332000",
      income: "132000",
    });
  });

  it.each([
    ["in", "1"],
    ["out", "-1"],
  ] as const)(
    "moves value less cost plus realized plus income by its value (%s)",
    (direction, sign) => {
      // Held at 120 a unit: before, 10 units worth 1200 that cost 1000.
      const [, after] = replay(
        [BOUGHT, yielded(direction, "2", "120", { date: "2026-09-10" })],
        "usd_mep",
        "mep",
      );
      const money = after!.position.money!;
      const value = Number(after!.position.quantity) * 120;
      const total =
        value -
        Number(money.cost) +
        Number(money.realized) +
        Number(money.income);
      expect(total - 200).toBe(Number(sign) * 240);
    },
  );
});

describe("a yield's cash flow", () => {
  const earned = [BOUGHT, yielded("in", "1", "110", { date: "2026-09-10" })];

  it("is its value, a return and not money in or out", () => {
    expect(flowsOf(earned)?.[1]).toEqual({
      date: "2026-09-10",
      amount: "110",
      kind: "yield",
      charges: "0",
    });
    expect(
      flowsOf([
        BOUGHT,
        yielded("out", "1", "110", { date: "2026-09-10" }),
      ])?.[1],
    ).toMatchObject({ amount: "-110", kind: "yield" });
  });

  it("counts in the result through the value, never as paid in", () => {
    // 1000 paid for 10, one more earned; 11 units at 110 today.
    expect(
      returnsOf(flowsOf(earned)!, { date: "2026-10-01", value: "1210" }),
    ).toMatchObject({ paidIn: "1000", paidOut: "0", result: "210" });
  });

  it("is a period's income and not its market move at a flat price", () => {
    const flows = flowsOf(earned)!;
    expect(
      periodResult({
        from: "2026-09-01",
        to: "2026-09-30",
        startValue: "1100",
        endValue: "1210",
        flows: flows.slice(1),
      }),
    ).toMatchObject({
      income: "110",
      contributed: "0",
      market: "0",
      result: "110",
      share: "0.1",
    });
  });

  it("leaves the market move to prices", () => {
    expect(
      periodResult({
        from: "2026-09-01",
        to: "2026-09-30",
        startValue: "1000",
        endValue: "1210",
        flows: flowsOf(earned)!.slice(1),
      }),
    ).toMatchObject({ income: "110", market: "100", result: "210" });
  });

  it("does not start the money at work", () => {
    // Nothing held at the start and units bought on the 20th: the money
    // works from the purchase, 11 of 30 days, whatever came in before it.
    const flows = [
      { date: "2026-09-15", amount: "100", kind: "yield", charges: "0" },
      { date: "2026-09-20", amount: "-1000", kind: "buy", charges: "0" },
    ] as const;
    const result = periodResult({
      from: "2026-08-31",
      to: "2026-09-30",
      startValue: "0",
      endValue: "1100",
      flows,
    });
    expect(result).toMatchObject({ income: "100", market: "0" });
    expect(result.share).toBe("0.1");
  });
});

it("leaves the yearly rate to the money paid in and out", () => {
  const bought = trade("purchase", "10", "100", { date: "2024-09-01" });
  const earned = yielded("in", "1", "110", { date: "2025-03-01" });
  const value = { date: "2026-09-01", value: "1210" };
  const without = returnsOf(flowsOf([bought])!, value);
  expect(returnsOf(flowsOf([bought, earned])!, value)).toEqual(without);
  expect(without.annual).not.toBeNull();
});

it("does not start the money at work with an income", () => {
  const result = periodResult({
    from: "2026-08-31",
    to: "2026-09-30",
    startValue: "0",
    endValue: "1000",
    flows: [
      { date: "2026-09-15", amount: "100", kind: "income", charges: "0" },
      { date: "2026-09-20", amount: "-1000", kind: "buy", charges: "0" },
    ],
  });
  expect(result).toMatchObject({ income: "100", market: "0", share: "0.1" });
});

it("takes no income or result for an adjustment out, whatever its price", () => {
  const steps = replay(
    [BOUGHT, adjustment("out", "5", { date: "2026-09-10", price: "50" })],
    "usd_mep",
    "mep",
  );
  expect(positionOf(steps).money).toMatchObject({
    cost: "500",
    income: "0",
    realized: "0",
  });
});
