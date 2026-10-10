import {
  compareDecimals,
  compareExact,
  decimalStringSchema,
  divideRounded,
  exactOf,
  fromScaled,
  moneySchema,
  over,
  plus,
  positiveDecimalSchema,
  roundedTo,
  times,
  toDecimal,
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
    ["a currency outside the enum", { amount: "1", currency: "EUR" }],
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

describe("divideRounded", () => {
  it.each([
    [5n, 2n, 3n],
    [-5n, 2n, -3n],
    [5n, -2n, -3n],
    [4n, 3n, 1n],
    [-4n, 3n, -1n],
  ])("rounds %p / %p half away from zero to %p", (n, d, expected) => {
    expect(divideRounded(n, d)).toBe(expected);
  });

  it("refuses a zero divisor", () => {
    expect(() => divideRounded(1n, 0n)).toThrow(RangeError);
  });
});

describe("fromScaled", () => {
  it.each([
    [0n, "0"],
    [150000000n, "1.5"],
    [-150000000n, "-1.5"],
    [-1n, "-0.00000001"],
    [100000000n, "1"],
  ])("writes %p as %p", (units, text) => {
    expect(fromScaled(units)).toBe(text);
  });

  it("formats past the stored integer digits, which do not parse", () => {
    const text = fromScaled(1234567890123n * 100000000n);
    expect(text).toBe("1234567890123");
    expect(decimalStringSchema.safeParse(text).success).toBe(false);
  });

  it("round-trips toScaled", () => {
    for (const text of ["0", "12.5", "-0.00000001", "999999999999.99999999"]) {
      expect(fromScaled(toScaled(text))).toBe(text);
    }
  });
});

describe("exact fractions", () => {
  const third = over(exactOf("1"), exactOf("3"));

  it("keeps the sign on the numerator", () => {
    const half = over(exactOf("1"), exactOf("-2"));
    expect(half).toEqual(exactOf("-0.5"));
    expect(compareExact(half, exactOf("0"))).toBe(-1);
  });

  it("stays exact through a product and keeps equal values equal", () => {
    expect(times(third, exactOf("3"))).toEqual(exactOf("1"));
  });

  it("adds nothing to zero", () => {
    expect(plus()).toEqual({ n: 0n, d: 1n });
    expect(plus(exactOf("1.5"), exactOf("2.25"))).toEqual(exactOf("3.75"));
  });

  it("compares by value", () => {
    expect(compareExact(third, exactOf("0.33333333"))).toBe(1);
    expect(compareExact(exactOf("-1"), exactOf("1"))).toBe(-1);
    expect(compareExact(times(third, exactOf("3")), exactOf("1"))).toBe(0);
  });

  it("refuses a zero divisor", () => {
    expect(() => over(exactOf("1"), exactOf("0"))).toThrow(RangeError);
  });

  it("rounds once on output, half away from zero", () => {
    expect(toDecimal(third, 8)).toBe("0.33333333");
    expect(toDecimal(exactOf("0.005"), 2)).toBe("0.01");
    expect(toDecimal(exactOf("-0.005"), 2)).toBe("-0.01");
    expect(toDecimal(exactOf("0.0049"), 2)).toBe("0");
    expect(toDecimal(exactOf("2.5"), 0)).toBe("3");
  });

  it("rounds to an exact value in reduced form", () => {
    expect(roundedTo(third, 2)).toEqual(exactOf("0.33"));
    expect(roundedTo(exactOf("0.005"), 2)).toEqual({ n: 1n, d: 100n });
    expect(roundedTo(exactOf("-2.5"), 0)).toEqual({ n: -3n, d: 1n });
  });

  it("refuses digits outside 0 to 8", () => {
    expect(() => toDecimal(third, 9)).toThrow(RangeError);
    expect(() => roundedTo(third, -1)).toThrow(RangeError);
    expect(() => roundedTo(third, 1.5)).toThrow(RangeError);
  });
});
