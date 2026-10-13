import { accountInTaxReport } from "./tax-report";

const ACCOUNTS = [
  { id: "a1", includeInTaxReport: true },
  { id: "a2", includeInTaxReport: false },
];

it("follows the account's own choice", () => {
  expect(accountInTaxReport(ACCOUNTS, "a1")).toBe(true);
  expect(accountInTaxReport(ACCOUNTS, "a2")).toBe(false);
});

it("counts an account the page does not list as included", () => {
  expect(accountInTaxReport(ACCOUNTS, "a3")).toBe(true);
});
