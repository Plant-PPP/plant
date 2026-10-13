import { type RealEstateSheet, sheetTerms } from "./sheet";

const SHEET: RealEstateSheet = {
  kind: "rented",
  purchase: { amount: "82000", currency: "USD", date: "2021-03-15" },
  monthlyRent: { amount: "650000", currency: "ARS" },
  monthlyExpenses: null,
  adjustment: null,
  payment: "mortgage",
  liabilityId: "d1",
};
const DEBT = {
  currency: "ARS" as const,
  uva: true,
  instrument_symbol: null,
  installment: "312.4",
};

it("hands core the property, the sheet's amounts and the debt", () => {
  const terms = sheetTerms({ amount: "95000", currency: "USD" }, SHEET, DEBT);
  expect(terms).toEqual({
    value: { amount: { n: 95000n, d: 1n }, currency: "USD" },
    purchase: { amount: { n: 82000n, d: 1n }, currency: "USD" },
    monthlyRent: { amount: { n: 650000n, d: 1n }, currency: "ARS" },
    monthlyExpenses: null,
    debt: DEBT,
  });
});

it("hands no debt for a property paid in cash, or a debt that is gone", () => {
  const property = { amount: "95000", currency: "USD" as const };
  expect(
    sheetTerms(property, { ...SHEET, payment: "cash", liabilityId: null }, DEBT)
      .debt,
  ).toBeNull();
  expect(sheetTerms(property, SHEET, undefined).debt).toBeNull();
});
