import { moneySchema } from "./money";

describe("moneySchema", () => {
  it("accepts a decimal string with its currency", () => {
    expect(
      moneySchema.parse({ amount: "1234567.89", currency: "ARS" }),
    ).toEqual({
      amount: "1234567.89",
      currency: "ARS",
    });
  });

  it("rejects a number, which would have gone through a float", () => {
    expect(
      moneySchema.safeParse({ amount: 1234.5, currency: "USD" }).success,
    ).toBe(false);
  });

  it("rejects a formatted amount", () => {
    expect(
      moneySchema.safeParse({ amount: "1.234,56", currency: "ARS" }).success,
    ).toBe(false);
  });
});
