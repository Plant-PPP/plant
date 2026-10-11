import { valueLiabilities } from "@plant/core";

import { buildFixtures } from "@/lib/prototype/fixtures";

import {
  createLiability,
  deleteLiability,
  updateLiability,
} from "./prototype-debts-store";
import { initialState } from "./prototype-store";

const TODAY = "2026-10-12";
const fixtures = buildFixtures(TODAY);
const state = initialState(fixtures, TODAY);
const NEW_ID = "e6000000-0000-4000-8000-000000000001";

const card = {
  kind: "credit_card",
  label: "Mastercard",
  lender: null,
  currency: "ARS",
  uva: false,
  instrument_symbol: null,
  balance: "1000",
  installment: null,
  annual_rate: null,
  installments_left: null,
  next_due_on: null,
  matures_on: null,
};

it("values every fixture debt, the UVA one at the day's UVA", () => {
  const uva = fixtures.quotes.fxRates.filter((row) => row.kind === "uva");
  const valued = valueLiabilities(
    fixtures.liabilities,
    {
      date: TODAY,
      fx: {
        uva: { sell: uva.at(-1)!.sell, date: TODAY },
        mep: { sell: "1200", date: TODAY },
      },
      prices: {},
    },
    { denominator: "ars", referenceDollar: "mep" },
  );
  expect(valued.complete).toBe(true);
});

it("creates, edits and deletes a debt", () => {
  const created = createLiability(state, card, NEW_ID);
  expect(created.result).toEqual({ ok: true, id: NEW_ID });
  const edited = updateLiability(created.state, NEW_ID, {
    ...card,
    balance: "2000",
  });
  expect(
    edited.state.liabilities.find((each) => each.id === NEW_ID)?.balance,
  ).toBe("2000");
  const deleted = deleteLiability(edited.state, NEW_ID);
  expect(deleted.state.liabilities).toHaveLength(state.liabilities.length);
});

it("refuses a debt in dollars counted in UVA", () => {
  expect(
    createLiability(state, { ...card, currency: "USD", uva: true }, NEW_ID)
      .result,
  ).toEqual({ ok: false, code: "invalid" });
});
