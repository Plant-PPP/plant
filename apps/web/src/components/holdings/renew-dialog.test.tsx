import { holdingSchema, type Placement } from "@plant/core";

import { FIELD_MESSAGES } from "./holding-fields";
import { RENEW_MESSAGES, renewFields, toRenewalInput } from "./renew-dialog";

const PLACEMENT = holdingSchema.parse({
  id: "h1",
  portfolio_id: "p1",
  asset_class: "fixed_term",
  instrument_symbol: null,
  amount: "1500000",
  currency: "ARS",
  annual_rate: "0.32",
  started_on: "2026-10-02",
  matures_on: "2026-10-09",
  valued_on: null,
  label: null,
}) as Placement;

it("starts on the day it matured, for as long a term, at its rate", () => {
  expect(renewFields(PLACEMENT)).toEqual({
    startedOn: "2026-10-09",
    maturesOn: "2026-10-16",
    rate: "32",
  });
});

it("sends the term and the rate as a fraction", () => {
  expect(toRenewalInput(renewFields(PLACEMENT), PLACEMENT)).toEqual({
    input: {
      started_on: "2026-10-09",
      matures_on: "2026-10-16",
      annual_rate: "0.32",
    },
  });
});

it.each([
  [{ rate: "abc" }, "rate"],
  [{ maturesOn: "2026-10-09" }, "maturesOn"],
  [{ startedOn: "2026-10-01" }, "maturesOn"],
])("refuses %j on the field it is about", (change, field) => {
  expect(
    toRenewalInput({ ...renewFields(PLACEMENT), ...change }, PLACEMENT),
  ).toEqual({ refused: field });
});

it("says the rate's rule as the holding dialog does", () => {
  expect(RENEW_MESSAGES.rate).toBe(FIELD_MESSAGES.rate);
});
