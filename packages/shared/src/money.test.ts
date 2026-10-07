import { decimalStringSchema, moneySchema } from "./money";

describe("moneySchema", () => {
  it("accepts a decimal string with its currency", () => {
    expect(
      moneySchema.parse({ amount: "1234567.89", currency: "ARS" }),
    ).toEqual({ amount: "1234567.89", currency: "ARS" });
  });

  it("rejects a number, which would have gone through a float", () => {
    expect(
      moneySchema.safeParse({ amount: 1234.5, currency: "USD" }).success,
    ).toBe(false);
  });
});

describe("decimalStringSchema", () => {
  it.each(["0", "-1", "0.5", "1234.56", "999999999999.99999999"])(
    "accepts %s",
    (value) => {
      expect(decimalStringSchema.safeParse(value).success).toBe(true);
    },
  );

  it.each([
    ["formatted es-AR", "1.234,56"],
    ["leading zero", "0001"],
    ["negative zero", "-0"],
    ["negative zero with decimals", "-0.00"],
    ["trailing dot", "1."],
    ["leading dot", ".5"],
    ["exponent", "1e5"],
    ["plus sign", "+1"],
    ["whitespace", " 1"],
    ["empty", ""],
    ["13 integer digits", "1234567890123"],
    ["9 decimals", "1.123456789"],
  ])("rejects %s", (_label, value) => {
    expect(decimalStringSchema.safeParse(value).success).toBe(false);
  });
});
