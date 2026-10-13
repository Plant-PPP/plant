import { buildFixtures } from "@/lib/prototype/fixtures";

import {
  deleteHolding,
  initialState,
  setRealEstateSheet,
} from "./prototype-store";

const TODAY = "2026-10-12";
const state = initialState(buildFixtures(TODAY), TODAY);
const PALERMO = "c2000000-0000-4000-8000-000000000003";
const CASH = "c2000000-0000-4000-8000-000000000001";
const MORTGAGE = "e5000000-0000-4000-8000-000000000001";

const SHEET = {
  kind: "home",
  purchase: null,
  monthlyRent: null,
  monthlyExpenses: { amount: "90000", currency: "ARS" },
  adjustment: null,
  payment: "cash",
  liabilityId: null,
};

it("starts with the flat's sheet, paid with the mortgage", () => {
  expect(state.realEstate.get(PALERMO)).toMatchObject({
    kind: "rented",
    payment: "mortgage",
    liabilityId: MORTGAGE,
  });
});

it("saves a property's sheet", () => {
  const saved = setRealEstateSheet(state, PALERMO, SHEET);
  expect(saved.result).toEqual({ ok: true, id: PALERMO });
  expect(saved.state.realEstate.get(PALERMO)).toEqual(SHEET);
});

it("refuses a sheet for what is not a property, or with a debt there is not", () => {
  expect(setRealEstateSheet(state, CASH, SHEET).result).toEqual({
    ok: false,
    code: "not_found",
  });
  expect(
    setRealEstateSheet(state, PALERMO, {
      ...SHEET,
      payment: "mortgage",
      liabilityId: "e5000000-0000-4000-8000-000000000099",
    }).result,
  ).toEqual({ ok: false, code: "not_found" });
  expect(
    setRealEstateSheet(state, PALERMO, { ...SHEET, payment: "mortgage" })
      .result,
  ).toEqual({ ok: false, code: "invalid" });
});

it("drops the sheet with its property", () => {
  const deleted = deleteHolding(state, PALERMO);
  expect(deleted.result.ok).toBe(true);
  expect(deleted.state.realEstate.has(PALERMO)).toBe(false);
});
