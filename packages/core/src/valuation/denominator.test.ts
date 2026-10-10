import { compareExact, exactOf, times, toDecimal } from "@plant/shared";
import { convert, express, lift, rate } from "./denominator";
import { DENOMINATORS, type Denominator } from "./denominators";
import { SNAPSHOT } from "./fixtures.test-support";

const usd = (amount: string) => ({
  amount: exactOf(amount),
  currency: "USD" as const,
});
const ars = (amount: string) => ({
  amount: exactOf(amount),
  currency: "ARS" as const,
});
const UNITS = Object.keys(DENOMINATORS) as Denominator[];

describe("lift", () => {
  it("keeps pesos as pesos in every view", () => {
    for (const view of UNITS) {
      expect(lift(ars("10"), view, "mep").denominator).toBe("ars");
    }
  });

  it.each([
    ["ars", "mep", "usd_mep"],
    ["ars", "ccl", "usd_ccl"],
    ["usd_mep", "ccl", "usd_mep"],
    ["usd_ccl", "mep", "usd_ccl"],
    ["usd_official", "mep", "usd_official"],
    ["btc", "ccl", "usd_mep"],
  ] as const)(
    "puts a held dollar in a %s view with reference %s as %s",
    (view, reference, expected) => {
      expect(lift(usd("10"), view, reference).denominator).toBe(expected);
    },
  );
});

describe("rate", () => {
  // One unit in pesos: ars 1, MEP 1200, CCL 1250, official 1000, BTC
  // 1200 × 65000 = 78,000,000.
  const PESOS: Record<Denominator, string> = {
    ars: "1",
    usd_mep: "1200",
    usd_ccl: "1250",
    usd_official: "1000",
    btc: "78000000",
  };

  it.each(UNITS.flatMap((from) => UNITS.map((to) => [from, to] as const)))(
    "prices one %s in %s at its rate in pesos",
    (from, to) => {
      const result = rate(from, to, SNAPSHOT);
      if ("missing" in result) throw new Error(result.missing);
      expect(
        compareExact(
          times(result.amount, exactOf(PESOS[to])),
          exactOf(PESOS[from]),
        ),
      ).toBe(0);
    },
  );

  it("inverts exactly", () => {
    for (const a of UNITS) {
      for (const b of UNITS) {
        const there = rate(a, b, SNAPSHOT);
        const back = rate(b, a, SNAPSHOT);
        if ("missing" in there || "missing" in back) throw new Error("missing");
        expect(times(there.amount, back.amount)).toEqual({ n: 1n, d: 1n });
      }
    }
  });

  // Between USD MEP and BTC the price alone converts: no rate, dated by it.
  it.each([
    ["usd_mep", "btc", "0.00001538"],
    ["btc", "usd_mep", "65000"],
  ] as const)("prices one %s in %s by the BTC price alone", (from, to, one) => {
    const result = rate(from, to, { ...SNAPSHOT, fx: {} });
    if ("missing" in result) throw new Error(result.missing);
    expect(toDecimal(result.amount, 8)).toBe(one);
    expect(result.dates).toEqual(["2026-10-12"]);
  });

  it("reads one BTC in pesos as MEP times its price", () => {
    const result = rate("btc", "ars", SNAPSHOT);
    if ("missing" in result) throw new Error(result.missing);
    expect(toDecimal(result.amount, 2)).toBe("78000000");
    expect(result.dates).toEqual(["2026-10-09", "2026-10-12"]);
  });

  it("names the rate it misses", () => {
    expect(rate("usd_ccl", "ars", { ...SNAPSHOT, fx: {} })).toEqual({
      missing: "ccl",
    });
    expect(rate("btc", "ars", { ...SNAPSHOT, prices: {} })).toEqual({
      missing: "BTC",
    });
    const inPesos = {
      ...SNAPSHOT,
      prices: {
        BTC: { price: "1", currency: "ARS" as const, date: "2026-10-12" },
      },
    };
    expect(rate("btc", "ars", inPesos)).toEqual({ missing: "BTC" });
    expect(rate("usd_mep", "btc", inPesos)).toEqual({ missing: "BTC" });
  });
});

describe("the owner's rule for dollars", () => {
  it("keeps a held dollar at face value in another dollar view", () => {
    const shown = express(
      usd("100"),
      SNAPSHOT.date,
      "usd_ccl",
      SNAPSHOT,
      "mep",
    );
    if ("missing" in shown) throw new Error(shown.missing);
    expect(toDecimal(shown.value.amount, 2)).toBe("100");
  });

  it("converts a dollar unit through pesos", () => {
    const result = rate("usd_mep", "usd_ccl", SNAPSHOT);
    if ("missing" in result) throw new Error(result.missing);
    expect(toDecimal(result.amount, 4)).toBe("0.96");
  });

  it("re-expresses a MEP value in CCL through pesos", () => {
    const moved = convert(
      { amount: exactOf("100"), denominator: "usd_mep" },
      "usd_ccl",
      SNAPSHOT,
    );
    if ("missing" in moved) throw new Error(moved.missing);
    expect(toDecimal(moved.value.amount, 2)).toBe("96");
  });

  it("prices a held BTC at its USD price in any dollar view", () => {
    const shown = express(
      { amount: exactOf("65000"), currency: "USD" },
      SNAPSHOT.date,
      "usd_ccl",
      SNAPSHOT,
      "mep",
    );
    const unit = rate("btc", "usd_ccl", SNAPSHOT);
    if ("missing" in shown || "missing" in unit) throw new Error("missing");
    expect(toDecimal(shown.value.amount, 2)).toBe("65000");
    expect(toDecimal(unit.amount, 2)).toBe("62400");
  });
});

describe("express", () => {
  it("dates a value by the oldest quote behind it", () => {
    const shown = express(
      ars("1200"),
      SNAPSHOT.date,
      "usd_mep",
      SNAPSHOT,
      "mep",
    );
    if ("missing" in shown) throw new Error(shown.missing);
    expect(shown.asOf).toBe("2026-10-09");
    expect(toDecimal(shown.value.amount, 2)).toBe("1");
  });

  it("needs no quote for pesos in pesos", () => {
    const shown = express(
      ars("5"),
      "2026-10-01",
      "ars",
      { date: "2026-10-12", fx: {}, prices: {} },
      "mep",
    );
    if ("missing" in shown) throw new Error(shown.missing);
    expect(shown.asOf).toBe("2026-10-01");
  });
});
