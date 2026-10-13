import type { RealEstateSheet } from "@/lib/real-estate/sheet";

import { sheetFields, toSheet } from "./real-estate-fields";

const SHEET: RealEstateSheet = {
  kind: "rented",
  purchase: { amount: "82000", currency: "USD", date: "2021-03-15" },
  monthlyRent: { amount: "650000", currency: "ARS" },
  monthlyExpenses: { amount: "120000.5", currency: "ARS" },
  adjustment: { index: "icl", everyMonths: 12 },
  payment: "mortgage",
  liabilityId: "d1",
};
const DEFAULTS = { currency: "USD" as const, today: "2026-10-12" };

it("reads a sheet back as it was saved", () => {
  expect(toSheet(sheetFields(SHEET, DEFAULTS))).toEqual({ sheet: SHEET });
});

it("starts a new sheet as a home paid in cash, with nothing stated", () => {
  const fields = sheetFields(undefined, DEFAULTS);
  expect(fields).toMatchObject({
    kind: "home",
    purchasePrice: "",
    purchaseCurrency: "USD",
    purchaseDate: "2026-10-12",
    payment: "cash",
  });
  expect(toSheet(fields)).toEqual({
    sheet: {
      kind: "home",
      purchase: null,
      monthlyRent: null,
      monthlyExpenses: null,
      adjustment: null,
      payment: "cash",
      liabilityId: null,
    },
  });
});

it.each([
  [{ purchasePrice: "abc" }, "purchasePrice"],
  [{ rent: "-5" }, "rent"],
  [{ expenses: "x" }, "expenses"],
  [{ everyMonths: "0" }, "everyMonths"],
  [{ everyMonths: "1,5" }, "everyMonths"],
  [{ liabilityId: "" }, "liabilityId"],
])("refuses %j on the field it is about", (change, field) => {
  expect(toSheet({ ...sheetFields(SHEET, DEFAULTS), ...change })).toEqual({
    refused: field,
  });
});

it("drops the debt of a property paid in cash", () => {
  const read = toSheet({ ...sheetFields(SHEET, DEFAULTS), payment: "cash" });
  expect(read).toMatchObject({ sheet: { payment: "cash", liabilityId: null } });
});
