import { liabilityInputSchema } from "@plant/core";

import { debtFields, toLiabilityInput } from "./debt-fields";

const fields = {
  ...debtFields(null),
  label: "Préstamo",
  balance: "1.000,50",
};

it("sends what the user typed, the rate as a fraction", () => {
  expect(
    liabilityInputSchema.parse(
      toLiabilityInput({ ...fields, installment: "100", rate: "62" }),
    ),
  ).toMatchObject({
    balance: "1000.50",
    installment: "100",
    annual_rate: "0.62",
  });
});

it.each([
  ["a cuota it cannot read", { installment: "abc" }],
  ["a rate it cannot read", { rate: "mucho" }],
  ["a capital above the balance", { principal: "2.000,00" }],
])("refuses %s instead of saving none", (_, typed) => {
  expect(
    liabilityInputSchema.safeParse(toLiabilityInput({ ...fields, ...typed }))
      .success,
  ).toBe(false);
});

it("leaves an empty optional field out", () => {
  expect(toLiabilityInput(fields)).toMatchObject({
    installment: null,
    annual_rate: null,
    principal: null,
  });
});

it("sends the capital in the debt's unit", () => {
  expect(
    liabilityInputSchema.parse(
      toLiabilityInput({ ...fields, principal: "900,25" }),
    ),
  ).toMatchObject({ principal: "900.25" });
});
