import { snapshotOn } from "@plant/core";
import { exactOf, minus, plus, stored } from "@plant/shared";

import { changeChart, lastClosed } from "@/lib/assistant/month-change";
import {
  scenarioOf,
  shockedSnapshot,
  validChange,
} from "@/lib/assistant/scenario";
import { buildFixtures } from "@/lib/prototype/fixtures";
import { changeBetween, closesOf, pricedToday } from "@/lib/summary/compute";

import { prototypeAnswer } from "./prototype-assistant";
import { holdingsView, initialState } from "./prototype-store";

const TODAY = "2026-10-12";
const state = {
  ...initialState(buildFixtures(TODAY), TODAY),
  recalculated: new Map<string, string>(),
};
const snapshot = snapshotOn(state.quotes, TODAY, {
  fxKinds: ["mep", "ccl", "official", "uva"],
  symbols: state.instruments.map(({ symbol }) => symbol),
}).snapshot;
const sum = (...values: string[]) =>
  stored(plus(...values.map((each) => exactOf(each))));

describe("changeBetween", () => {
  const closes = closesOf(state, "ars");
  const last = lastClosed(closes)!;

  it("splits a month's change into parts that add up to it exactly", () => {
    for (const unit of ["ars", "usd_mep"] as const) {
      const change = changeBetween(state, unit, last, last)!;
      expect(
        sum(
          change.startValue,
          change.contributed,
          change.prices,
          change.dollar,
          change.yields,
        ),
      ).toBe(stored(exactOf(change.endValue)));
      const close = closesOf(state, unit).find((each) => each.period === last)!;
      expect(change.result).toBe(close.figures.result);
      expect(sum(change.prices, change.dollar)).toBe(close.figures.market);
    }
  });

  it("takes the last closed month, not the one in progress", () => {
    expect(last).toBe("2026-09");
    expect(closes.at(-1)!.open).toBe(true);
  });

  it("adds consecutive months up, in either order", () => {
    const from = closes.at(-4)!.period;
    const whole = changeBetween(state, "ars", from, last)!;
    expect(changeBetween(state, "ars", last, from)).toEqual(whole);
    expect(whole.months).toBe(3);
    const months = closes
      .slice(-4, -1)
      .map((each) => changeBetween(state, "ars", each.period, each.period)!);
    for (const key of ["contributed", "prices", "dollar", "yields"] as const) {
      expect(whole[key]).toBe(sum(...months.map((each) => each[key])));
    }
    expect(whole.startValue).toBe(months[0]!.startValue);
    expect(whole.endValue).toBe(months.at(-1)!.endValue);
  });

  it("finds nothing outside the closes", () => {
    expect(changeBetween(state, "ars", "1999-01", "1999-02")).toBeNull();
  });

  it("draws a waterfall from the start to the end", () => {
    const change = changeBetween(state, "ars", last, last)!;
    const chart = changeChart(change, "ars");
    expect(chart.template).toBe("waterfall");
    expect(chart.points[0]).toEqual({
      label: "Al empezar",
      value: change.startValue,
    });
    expect(chart.points.at(-1)).toEqual({
      label: "Al terminar",
      value: change.endValue,
    });
    expect(sum(...chart.points.slice(0, -1).map((each) => each.value))).toBe(
      stored(exactOf(change.endValue)),
    );
  });
});

describe("scenarioOf", () => {
  const priced = pricedToday(state);
  const holdings = holdingsView(state).active.map((row) => row.holding);
  const run = (
    unit: "ars" | "usd_mep",
    shock: Parameters<typeof scenarioOf>[0]["shock"],
  ) =>
    scenarioOf({
      holdings,
      liabilities: state.liabilities,
      snapshot: priced,
      unit,
      referenceDollar: state.referenceDollar,
      shock,
    });

  it("moves only the quotes it names", () => {
    const moved = shockedSnapshot(priced, {
      dollar: { kind: "mep", change: "10" },
    });
    expect(Number(moved.fx.mep!.sell)).toBeCloseTo(
      Number(priced.fx.mep!.sell) * 1.1,
      6,
    );
    expect(moved.fx.ccl).toEqual(priced.fx.ccl);
    expect(moved.prices).toEqual(priced.prices);
    const apple = shockedSnapshot(priced, {
      price: { symbol: "AAPL", change: "-20" },
    });
    expect(Number(apple.prices.AAPL!.price)).toBeCloseTo(
      Number(priced.prices.AAPL!.price) * 0.8,
      6,
    );
    expect(apple.prices.KO).toEqual(priced.prices.KO);
    expect(apple.fx).toEqual(priced.fx);
  });

  it("changes nothing with no move, and its net worth adds up", () => {
    const still = run("ars", { dollar: { kind: "all", change: "0" } });
    expect(still.scenario).toEqual(still.today);
    expect(still.change).toBe("0");
    expect(still.scenario.netWorth).toBe(
      stored(
        minus(exactOf(still.scenario.assets), exactOf(still.scenario.debts)),
      ),
    );
  });

  it("values dollars up in pesos and pesos down in dollars when the dollar rises", () => {
    const shock = { dollar: { kind: "all" as const, change: "10" } };
    const pesos = run("ars", shock);
    expect(Number(pesos.scenario.assets)).toBeGreaterThan(
      Number(pesos.today.assets),
    );
    // The peso debts (a UVA mortgage) shrink in dollars more than the peso
    // assets do.
    const dollars = run("usd_mep", shock);
    expect(Number(dollars.scenario.assets)).toBeLessThan(
      Number(dollars.today.assets),
    );
    expect(Number(dollars.scenario.debts)).toBeLessThan(
      Number(dollars.today.debts),
    );
    expect(dollars.change).toBe(
      stored(
        minus(
          exactOf(dollars.scenario.netWorth),
          exactOf(dollars.today.netWorth),
        ),
      ),
    );
  });

  it("takes a percent above -100 and up to 1000 only", () => {
    expect(["10", "-15.5", "1000", "-99.99", "0"].every(validChange)).toBe(
      true,
    );
    expect(["-100", "1000.01", "10,5", "abc", "1e3"].some(validChange)).toBe(
      false,
    );
  });
});

describe("the prototype assistant", () => {
  const ask = (question: string) =>
    prototypeAnswer(state, question, "usd_mep", snapshot);

  it.each([
    ["¿Qué pasa si el MEP sube 10 %?", /el dólar MEP sube 10 %/],
    ["¿Y si Apple cae 20%?", /el precio de Apple baja 20 %/],
    ["Si el dólar baja un 5 por ciento", /el dólar \(MEP, CCL y oficial\)/],
  ])("answers %s as a labelled hypothetical", (question, assumption) => {
    const answer = ask(question);
    expect(answer.text).toMatch(/^Hipotético: si /);
    expect(answer.text).toMatch(assumption);
    expect(answer.text).toMatch(/no es una predicción/);
    expect(answer.charts[0]?.title).toBe(
      "Escenario hipotético: tu patrimonio neto",
    );
  });

  it("still refuses to advise when a hypothetical asks what to do", () => {
    expect(ask("Si el MEP sube 10 %, ¿me conviene vender?").text).toMatch(
      /no recomienda/,
    );
  });

  it.each(["¿Por qué cambió mi patrimonio el mes pasado?", "Resumen del mes"])(
    "explains %s part by part, with a waterfall",
    (question) => {
      const answer = ask(question);
      expect(answer.text).toMatch(
        /^En septiembre de 2026 tu patrimonio pasó de/,
      );
      expect(answer.text).toMatch(/los precios/);
      expect(answer.text).toMatch(/el dólar/);
      expect(answer.charts[0]?.template).toBe("waterfall");
    },
  );
});
