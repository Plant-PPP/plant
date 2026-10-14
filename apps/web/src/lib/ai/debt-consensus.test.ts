import { DRAFT_DEBT_LIMIT, type DraftDebt } from "@plant/sources";

import { mergeDebts } from "./debt-consensus";

const debt = (patch: Partial<DraftDebt> = {}): DraftDebt => ({
  label: "Visa",
  lender: "Galicia",
  currency: "ARS",
  balance: "250000.50",
  minimumPayment: "25000",
  dueDate: "2026-10-20",
  confidence: "high",
  page: 1,
  ...patch,
});

it("keeps what both readings agree on", () => {
  expect(mergeDebts([debt()], [debt({ balance: "250000.5" })]).rows).toEqual([
    debt(),
  ]);
});

it("leaves a figure or date the readings disagree on for the review, low", () => {
  expect(
    mergeDebts(
      [debt()],
      [debt({ balance: "205000.50", dueDate: "2026-10-21" })],
    ).rows,
  ).toEqual([debt({ balance: null, dueDate: null, confidence: "low" })]);
});

it("marks low a figure only one reading printed", () => {
  expect(mergeDebts([debt({ dueDate: null })], [debt()]).rows).toEqual([
    debt({ dueDate: null, confidence: "low" }),
  ]);
});

it("pairs debts by currency and keeps one only a reading lists, low", () => {
  const usd = debt({ currency: "USD", balance: "120", minimumPayment: null });
  expect(mergeDebts([debt()], [usd, debt()]).rows).toEqual([
    debt(),
    { ...usd, confidence: "low" },
  ]);
});

it("takes the card's name from the second reading when the first has none", () => {
  expect(mergeDebts([debt({ label: null })], [debt()]).rows[0]!.label).toBe(
    "Visa",
  );
});

it("counts the debts past the limit the two readings make together as cut", () => {
  const ars = Array.from({ length: 6 }, () => debt());
  const usd = Array.from({ length: 6 }, () => debt({ currency: "USD" }));
  const merged = mergeDebts(
    [...ars, ...usd.slice(0, 4)],
    [...ars.slice(0, 4), ...usd],
  );
  expect(merged.rows).toHaveLength(DRAFT_DEBT_LIMIT);
  expect(merged.cut).toBe(12 - DRAFT_DEBT_LIMIT);
});
