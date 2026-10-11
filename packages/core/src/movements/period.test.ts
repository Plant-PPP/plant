import { chainedShare, periodResult } from "./period";

const MONTH = { from: "2026-08-31", to: "2026-09-30" };

it("counts money put in as a contribution, not a gain", () => {
  const result = periodResult({
    ...MONTH,
    startValue: "1000",
    endValue: "1500",
    flows: [{ date: "2026-09-15", amount: "-500", kind: "buy" }],
  });
  expect(result).toMatchObject({
    paidIn: "500",
    contributed: "500",
    market: "0",
    result: "0",
    share: "0",
  });
});

it("splits a month's change into market, income and contributions", () => {
  const result = periodResult({
    ...MONTH,
    startValue: "1000",
    endValue: "1150",
    flows: [
      { date: "2026-09-10", amount: "-200", kind: "buy" },
      { date: "2026-09-20", amount: "100", kind: "sell" },
      { date: "2026-09-25", amount: "10", kind: "income" },
    ],
  });
  expect(result).toMatchObject({
    paidIn: "200",
    proceeds: "100",
    income: "10",
    contributed: "100",
    market: "50",
    result: "60",
  });
  // 60 over 1000, plus 200 for two thirds of the month, less 100 for a
  // third and 10 for a sixth: 1098.33…
  expect(Number(result.share)).toBeCloseTo(
    60 / (1000 + 133.333 - 33.333 - 1.667),
    6,
  );
});

it("has no return with no money at work", () => {
  expect(
    periodResult({ ...MONTH, startValue: "0", endValue: "0", flows: [] }).share,
  ).toBeNull();
});

it("chains monthly returns into a yearly one", () => {
  expect(chainedShare(["0.1", "-0.05"])).toBe("0.045");
  expect(chainedShare(["0.1", null])).toBeNull();
  expect(chainedShare([])).toBe("0");
});
