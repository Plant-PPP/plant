import { quantityOn } from "../movements/admit";
import { income, trade } from "../movements/fixtures.test-support";
import type { Movement } from "../movements/movement";
import { incomePattern, upcomingFrom } from "./upcoming";

// A holding's payments ahead on the units it holds today, as the assistant
// reads them.
const upcomingIncome = (
  movements: readonly Movement[],
  today: string,
  days: number,
) =>
  upcomingFrom(
    incomePattern(movements, today),
    quantityOn(movements, today),
    today,
    days,
  );

const TODAY = "2026-10-12";

const quarterly = [
  trade("purchase", "10", "100", { date: "2026-01-02" }),
  income("dividend", "5", { date: "2026-03-01" }),
  income("dividend", "5", { date: "2026-05-30" }),
  income("dividend", "6", { date: "2026-08-28" }),
  trade("purchase", "10", "100", { date: "2026-09-15" }),
];

it("expects the next payment a typical gap after the last, at its rate per unit on today's units", () => {
  // Gaps of 90 and 90 days; the last paid 0.6 a unit, on 20 units held now.
  expect(upcomingIncome(quarterly, TODAY, 90)).toEqual([
    { kind: "dividend", date: "2026-11-26", currency: "USD", amount: "12" },
  ]);
});

it("repeats within the window, and counts units sold since", () => {
  const sold = [
    ...quarterly,
    trade("sale", "15", "100", { date: "2026-10-01" }),
  ];
  expect(upcomingIncome(sold, TODAY, 200)).toEqual([
    { kind: "dividend", date: "2026-11-26", currency: "USD", amount: "3" },
    { kind: "dividend", date: "2027-02-24", currency: "USD", amount: "3" },
  ]);
});

it("expects nothing from a holding that paid once, sold out or stopped paying", () => {
  expect(upcomingIncome(quarterly.slice(0, 2), TODAY, 90)).toEqual([]);
  expect(
    upcomingIncome(
      [...quarterly, trade("sale", "20", "100", { date: "2026-10-01" })],
      TODAY,
      90,
    ),
  ).toEqual([]);
  expect(upcomingIncome(quarterly, "2027-04-01", 90)).toEqual([]);
});

it("skips a payment that was due before today", () => {
  // Due 2026-11-26, then 2027-02-24: on 2026-12-01 only the second is ahead.
  expect(upcomingIncome(quarterly, "2026-12-01", 90)).toEqual([
    { kind: "dividend", date: "2027-02-24", currency: "USD", amount: "12" },
  ]);
});

it("keeps a coupon's kind and currency", () => {
  const bond = [
    trade("purchase", "1000", "0.6", { date: "2026-01-02", currency: "USD" }),
    income("coupon", "4.5", { date: "2026-01-09" }),
    income("coupon", "4.5", { date: "2026-07-09" }),
  ];
  expect(upcomingIncome(bond, TODAY, 120)).toEqual([
    { kind: "coupon", date: "2027-01-06", currency: "USD", amount: "4.5" },
  ]);
});
