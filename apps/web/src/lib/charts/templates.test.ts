import type { TopLevelSpec } from "vega-lite";

import { d3FormatLocale } from "./format-locale";
import {
  CHART_TEMPLATES,
  type ChartDatum,
  netWorthSpec,
  templateSpec,
} from "./templates";

const DATA: ChartDatum[] = [
  { label: "Acciones", value: "1500.5", shown: "$ 1.500,50" },
  { label: "Bonos", value: "-200", shown: "-$ 200,00" },
  { label: "Cripto", value: "3000", shown: "$ 3.000,00" },
];

const values = (spec: TopLevelSpec) =>
  ("data" in spec && spec.data && "values" in spec.data
    ? spec.data.values
    : []) as Record<string, unknown>[];

it("prints each figure as the app formatted it, never as Vega rounds it", () => {
  for (const template of CHART_TEMPLATES) {
    const text = JSON.stringify(templateSpec(template, DATA));
    if (template === "net_worth") continue;
    expect(text).toContain('"text":{"field":"shown"}');
  }
  expect(
    values(templateSpec("ranking", DATA)).map((each) => each.shown),
  ).toEqual(["$ 1.500,50", "-$ 200,00", "$ 3.000,00"]);
});

it("keeps the order a distribution is given, and ranks the largest first", () => {
  const sortOf = (spec: TopLevelSpec) =>
    JSON.stringify(
      (spec as { encoding?: { y?: { sort?: unknown } } }).encoding?.y?.sort,
    );
  expect(sortOf(templateSpec("distribution", DATA))).toBe(
    '["Acciones","Bonos","Cripto"]',
  );
  expect(sortOf(templateSpec("ranking", DATA))).toBe(
    '["Cripto","Acciones","Bonos"]',
  );
});

it("draws what was put in only when given", () => {
  const months = DATA.map((each) => ({ ...each, label: each.label }));
  expect((netWorthSpec(months) as { layer: unknown[] }).layer).toHaveLength(1);
  expect(
    (netWorthSpec(months, months) as { layer: unknown[] }).layer,
  ).toHaveLength(2);
});

it("formats numbers the es-AR way", () => {
  expect(d3FormatLocale("es-AR")).toMatchObject({
    decimal: ",",
    thousands: ".",
  });
});
