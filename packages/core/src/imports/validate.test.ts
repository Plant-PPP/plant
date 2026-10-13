import {
  documentDateIssue,
  validateHoldings,
  type ValidatedRow,
} from "./validate";

const row = (fields: Partial<ValidatedRow>): ValidatedRow => ({
  symbol: "ZKO",
  quantity: "1",
  price: null,
  value: null,
  basis: 1,
  ...fields,
});

const issuesOf = (fields: Partial<ValidatedRow>) =>
  validateHoldings([row(fields)])[0];

describe("value_mismatch", () => {
  it("allows a cent between quantity × price and the printed value", () => {
    expect(issuesOf({ price: "10.00", value: "10.01" })).toEqual([]);
    expect(issuesOf({ price: "10.00", value: "9.99" })).toEqual([]);
    expect(issuesOf({ price: "10.00", value: "10.02" })).toEqual([
      "value_mismatch",
    ]);
  });

  it("rounds a crypto's value to cents before comparing", () => {
    // 0.5 × 65000.15 = 32500.075, rounded to 32500.08.
    const crypto = { quantity: "0.5", price: "65000.15" };
    expect(issuesOf({ ...crypto, value: "32500.09" })).toEqual([]);
    expect(issuesOf({ ...crypto, value: "32500.06" })).toEqual([
      "value_mismatch",
    ]);
  });

  it("allows the half of the price's last printed digit", () => {
    // 1000 × 12.3 = 12300; the price may have been 12.25 to 12.35, so the
    // value may be 50 away.
    const cedear = { quantity: "1000", price: "12.3" };
    expect(issuesOf({ ...cedear, value: "12350" })).toEqual([]);
    expect(issuesOf({ ...cedear, value: "12250" })).toEqual([]);
    expect(issuesOf({ ...cedear, value: "12350.01" })).toEqual([
      "value_mismatch",
    ]);
  });

  it("prices a bond per 100 nominal", () => {
    // 10000 × 85.5 / 100 = 8550, with 10000 × 0.05 / 100 = 5 of slack.
    const bond = { quantity: "10000", price: "85.5", basis: 100 as const };
    expect(issuesOf({ ...bond, value: "8550" })).toEqual([]);
    expect(issuesOf({ ...bond, value: "8555" })).toEqual([]);
    expect(issuesOf({ ...bond, value: "8555.01" })).toEqual(["value_mismatch"]);
    expect(issuesOf({ ...bond, basis: 1, value: "8550" })).toEqual([
      "value_mismatch",
    ]);
  });

  it("checks nothing without both a price and a value, or with a bad number", () => {
    expect(issuesOf({ price: "10", value: null })).toEqual([]);
    expect(issuesOf({ price: null, value: "99" })).toEqual([]);
    expect(issuesOf({ price: "1,5", value: "99" })).toEqual([]);
  });
});

describe("duplicate_symbol", () => {
  it("marks every row whose symbol repeats, but not a blank one", () => {
    expect(
      validateHoldings([
        row({ symbol: "ZB30" }),
        row({ symbol: "ZKO" }),
        row({ symbol: "ZB30" }),
        row({ symbol: "" }),
        row({ symbol: "" }),
      ]),
    ).toEqual([["duplicate_symbol"], [], ["duplicate_symbol"], [], []]);
  });

  it("lists both issues on one row", () => {
    const wrong = row({ price: "10", value: "11" });
    expect(validateHoldings([wrong, row({})])).toEqual([
      ["value_mismatch", "duplicate_symbol"],
      ["duplicate_symbol"],
    ]);
  });
});

describe("documentDateIssue", () => {
  const today = "2026-10-13";

  it("flags a date after today or before 1990", () => {
    expect(documentDateIssue("2026-10-14", today)).toBe("future");
    expect(documentDateIssue("1989-12-31", today)).toBe("old");
  });

  it("accepts today, 1990-01-01 and a missing date", () => {
    expect(documentDateIssue(today, today)).toBeNull();
    expect(documentDateIssue("1990-01-01", today)).toBeNull();
    expect(documentDateIssue(null, today)).toBeNull();
  });
});
