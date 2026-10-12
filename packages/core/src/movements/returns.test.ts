import { adjustment, income, trade } from "./fixtures.test-support";
import { replay } from "./replay";
import { cashFlowsOf, returnsOf } from "./returns";

const flowsOf = (movements: Parameters<typeof replay>[0]) =>
  cashFlowsOf(movements, replay(movements, "usd_mep", "mep"));

// Bought at 100, up 10 % and sold, bought again at 110, now at 115.
const ROUND_TRIP = [
  trade("purchase", "1", "100", { date: "2024-01-01" }),
  trade("sale", "1", "110", { date: "2024-07-01" }),
  trade("purchase", "1", "110", { date: "2024-07-01" }),
];

it("pays in purchases and their charges and pays out sales less theirs", () => {
  expect(
    flowsOf([
      trade("purchase", "2", "100", { date: "2025-01-01", fees: "1" }),
      trade("sale", "1", "120", { date: "2025-02-01", fees: "2" }),
      income("dividend", "5", { date: "2025-03-01", taxes: "1" }),
    ]),
  ).toEqual([
    { date: "2025-01-01", amount: "-201", kind: "buy", charges: "1" },
    { date: "2025-02-01", amount: "118", kind: "sell", charges: "2" },
    { date: "2025-03-01", amount: "4", kind: "income", charges: "1" },
  ]);
});

it("counts an adjustment's units at the cost the replay gives them", () => {
  const flows = flowsOf([
    trade("purchase", "1", "100", { date: "2025-01-01" }),
    adjustment("in", "1", { date: "2025-02-01", price: "80", fees: "1" }),
    adjustment("out", "1", { date: "2025-03-01" }),
  ])!;
  expect(flows[1]).toEqual({
    date: "2025-02-01",
    amount: "-81",
    kind: "buy",
    charges: "1",
  });
  // Out at the average cost of the two units held.
  expect(flows[2]).toEqual({
    date: "2025-03-01",
    amount: "90",
    kind: "sell",
    charges: "0",
  });
});

it("counts the whole result of a round trip, sold gains included", () => {
  const returns = returnsOf(flowsOf(ROUND_TRIP)!, {
    date: "2025-07-01",
    value: "115",
  });
  expect(returns).toMatchObject({
    paidIn: "210",
    paidOut: "110",
    result: "15",
  });
  // 15 over 210 paid in, though only 100 was at stake at a time.
  expect(returns.share).toBe("0.07142857");
  // 100 grew to 115 over a year and a half: about 9.8 % a year.
  expect(Number(returns.annual)).toBeCloseTo(0.0976, 3);
});

it("gives no yearly rate under a year", () => {
  expect(
    returnsOf(flowsOf(ROUND_TRIP)!, { date: "2024-12-01", value: "115" })
      .annual,
  ).toBeNull();
});

it("gives no share with nothing paid in", () => {
  expect(returnsOf([], { date: "2025-01-01", value: "0" }).share).toBeNull();
});
