import { rowsToInstallments } from "./debt-installments-dialog";

it("reads typed rows as the plan, in es-AR amounts", () => {
  expect(
    rowsToInstallments([
      { date: "2026-10-31", amount: "3160" },
      { date: "2026-11-30", amount: "8.160,50" },
    ]),
  ).toEqual([
    { due_on: "2026-10-31", amount: "3160" },
    { due_on: "2026-11-30", amount: "8160.50" },
  ]);
});

it("refuses a row without a date or with a zero amount", () => {
  expect(rowsToInstallments([{ date: "", amount: "1" }])).toBeNull();
  expect(rowsToInstallments([{ date: "2026-10-31", amount: "0" }])).toBeNull();
});
