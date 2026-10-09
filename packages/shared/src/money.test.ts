import {
  compareDecimals,
  decimalStringSchema,
  moneySchema,
  positiveDecimalSchema,
  toScaled,
} from "./money";

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

  it.each([
    ["an amount without its currency", { amount: "1" }],
    ["a null amount", { amount: null, currency: "ARS" }],
  ])("rejects %s", (_label, value) => {
    expect(moneySchema.safeParse(value).success).toBe(false);
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

describe("positiveDecimalSchema", () => {
  it.each(["0.00000001", "1", "1050.5", "999999999999.99999999"])(
    "accepts %s",
    (value) => {
      expect(positiveDecimalSchema.safeParse(value).success).toBe(true);
    },
  );

  it.each(["0", "0.00000000", "-1", "-0.5", "1e5", "1.123456789"])(
    "rejects %s",
    (value) => {
      expect(positiveDecimalSchema.safeParse(value).success).toBe(false);
    },
  );
});

describe("toScaled", () => {
  it.each([
    ["0", 0n],
    ["1", 100000000n],
    ["0.00000001", 1n],
    ["-1.5", -150000000n],
    ["999999999999.99999999", 99999999999999999999n],
  ])("scales %s", (value, scaled) => {
    expect(toScaled(value)).toBe(scaled);
  });

  it.each(["", "-", "0x10", " 1", "1.123456789", "1.0x5", "1e5"])(
    "refuses %j, which decimalStringSchema refuses",
    (value) => {
      expect(() => toScaled(value)).toThrow(RangeError);
    },
  );
});

describe("compareDecimals", () => {
  it.each([
    ["1.5", "1.50", 0],
    ["999.99", "1000", -1],
    ["0.1", "0.09", 1],
    ["-1", "0.5", -1],
    ["999999999999.99999999", "999999999999.99999998", 1],
  ])("compares %s with %s as %i", (a, b, sign) => {
    expect(compareDecimals(a, b)).toBe(sign);
  });
});
