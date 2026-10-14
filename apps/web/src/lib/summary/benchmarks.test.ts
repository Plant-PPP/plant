import type { QuoteSnapshot } from "@plant/core";

import { benchmarksBetween, beyond, chainedChange } from "./benchmarks";

const snapshot = (fx: Record<string, string>): QuoteSnapshot =>
  ({
    date: "2026-09-30",
    fx: Object.fromEntries(
      Object.entries(fx).map(([kind, sell]) => [
        kind,
        { sell, buy: null, date: "2026-09-30" },
      ]),
    ),
    prices: {},
  }) as unknown as QuoteSnapshot;

it("reads inflation from the UVA and the dollar from the MEP", () => {
  expect(
    benchmarksBetween(
      snapshot({ uva: "1000", mep: "1200" }),
      snapshot({ uva: "1030", mep: "1260" }),
    ),
  ).toEqual({ inflation: "0.03", dollar: "0.05" });
});

it("knows no change for a rate missing at either end", () => {
  expect(
    benchmarksBetween(snapshot({ mep: "1200" }), snapshot({ uva: "1030" })),
  ).toEqual({ inflation: null, dollar: null });
});

it("chains a year's months, and knows none when a month is unknown", () => {
  expect(chainedChange(["0.1", "0.1"])).toBe("0.21");
  expect(chainedChange(["0.1", null])).toBeNull();
  expect(chainedChange([])).toBeNull();
});

it("sets a return against a change", () => {
  // 10 % made while prices rose 4 %: 5.77 % real.
  expect(beyond("0.1", "0.04")).toBe("0.05769231");
  // 2 % made while the dollar rose 5 %: 2.86 % lost against it.
  expect(beyond("0.02", "0.05")).toBe("-0.02857143");
  expect(beyond(null, "0.04")).toBeNull();
  expect(beyond("0.1", null)).toBeNull();
});
