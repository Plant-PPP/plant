import { stored } from "@plant/shared";

import { interestTo, placementFigures } from "./placement";

// One million pesos for 30 days at 35% TNA.
const PLACEMENT = {
  amount: "1000000",
  annual_rate: "0.35",
  started_on: "2026-09-01",
  matures_on: "2026-10-01",
};

describe("interestTo", () => {
  it("is simple interest, actual/365, credited in cents", () => {
    expect(stored(interestTo(PLACEMENT, "2026-09-13"))).toBe("11506.85");
  });

  it("stops at the maturity and earns nothing before the start", () => {
    expect(interestTo(PLACEMENT, "2027-01-01")).toEqual(
      interestTo(PLACEMENT, "2026-10-01"),
    );
    expect(interestTo(PLACEMENT, "2026-08-01")).toEqual({ n: 0n, d: 1n });
    expect(interestTo(PLACEMENT, "2026-09-01")).toEqual({ n: 0n, d: 1n });
  });
});

describe("placementFigures", () => {
  const figures = placementFigures(PLACEMENT, "2026-09-13");

  it("gives the interest to today and the whole term's, and the amount it ends with", () => {
    expect(figures).toMatchObject({
      accrued: "11506.85",
      atMaturity: "28767.12",
      maturityAmount: "1028767.12",
      days: 30,
    });
  });

  it("gives the effective annual rate of placing each term's interest again", () => {
    expect(figures.effectiveRate).toBe("0.412075");
  });

  it("has no effective rate for a term of no days", () => {
    expect(
      placementFigures({ ...PLACEMENT, matures_on: "2026-09-01" }, "2026-09-01")
        .effectiveRate,
    ).toBeNull();
  });
});
