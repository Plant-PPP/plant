import { chainedShare, periodResult } from "./period";

const MONTH = { from: "2026-08-31", to: "2026-09-30" };

it("counts money put in as a contribution, not a gain", () => {
  const result = periodResult({
    ...MONTH,
    startValue: "1000",
    endValue: "1500",
    flows: [{ date: "2026-09-15", amount: "-500", kind: "buy", charges: "0" }],
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
      { date: "2026-09-10", amount: "-200", kind: "buy", charges: "0" },
      { date: "2026-09-20", amount: "100", kind: "sell", charges: "0" },
      { date: "2026-09-25", amount: "10", kind: "income", charges: "0" },
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

it("keeps charges out of the market result", () => {
  // 10 units at 100 held, 10 more bought at 100 with 5 of commission, and
  // the price unchanged.
  const result = periodResult({
    ...MONTH,
    startValue: "1000",
    endValue: "2000",
    flows: [{ date: "2026-09-15", amount: "-1005", kind: "buy", charges: "5" }],
  });
  expect(result).toMatchObject({
    paidIn: "1000",
    charges: "5",
    market: "0",
    result: "-5",
  });
});

it("counts an income before its withholding, which goes to charges", () => {
  const result = periodResult({
    ...MONTH,
    startValue: "1000",
    endValue: "1000",
    flows: [{ date: "2026-09-15", amount: "9", kind: "income", charges: "1" }],
  });
  expect(result).toMatchObject({ income: "10", charges: "1", result: "9" });
});

it("makes nothing out of no money at work, which keeps a year's chain", () => {
  const empty = periodResult({
    ...MONTH,
    startValue: "0",
    endValue: "0",
    flows: [],
  });
  expect(empty.share).toBe("0");
  expect(chainedShare(["0.1", empty.share, "0.05"])).toBe("0.155");
});

it("has no return when something was made out of nothing at work", () => {
  expect(
    periodResult({ ...MONTH, startValue: "0", endValue: "10", flows: [] })
      .share,
  ).toBeNull();
});

it("chains monthly returns into a yearly one", () => {
  expect(chainedShare(["0.1", "-0.05"])).toBe("0.045");
  expect(chainedShare(["0.1", null])).toBeNull();
  expect(chainedShare([])).toBe("0");
});
