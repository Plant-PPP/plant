import { compareDecimals } from "@plant/shared";
import type { TopLevelSpec } from "vega-lite";

// The charts Plant draws, each a Vega-Lite spec built from figures the server
// computed: a value only places a mark, and every number the chart prints is
// the text the app formatted, never one Vega rounds.
export const CHART_TEMPLATES = [
  "distribution",
  "net_worth",
  "income",
  "debts",
  "ranking",
] as const;
export type ChartTemplate = (typeof CHART_TEMPLATES)[number];

// A labelled figure: its value as a decimal string, and as the app shows it.
export type ChartDatum = { label: string; value: string; shown: string };

const SCHEMA = "https://vega.github.io/schema/vega-lite/v6.json";

// Positions on screen only: a mark needs no exact decimal.
const plotted = (data: readonly ChartDatum[]) =>
  data.map((each, order) => ({
    label: each.label,
    value: Number(each.value),
    shown: each.shown,
    order,
  }));

// The labels in the order the chart shows them: as given, or the largest
// value first. Vega takes the list as it is, across every layer.
const labelOrder = (data: readonly ChartDatum[], sort: "given" | "largest") =>
  (sort === "largest"
    ? [...data].sort((a, b) => compareDecimals(b.value, a.value))
    : data
  ).map((each) => each.label);

// Horizontal bars, one per label, each naming its value at its end: what a
// whole splits into, the largest holdings, or what is owed. `sort` keeps the
// order given or puts the largest first; a negative value is drawn in red.
function horizontalBars(
  data: readonly ChartDatum[],
  { sort, colorByLabel }: { sort: "given" | "largest"; colorByLabel: boolean },
): TopLevelSpec {
  return {
    $schema: SCHEMA,
    width: "container",
    height: { step: 28 },
    data: { values: plotted(data) },
    encoding: {
      y: {
        field: "label",
        type: "nominal",
        sort: labelOrder(data, sort),
        axis: { labelLimit: 140 },
      },
      x: { field: "value", type: "quantitative", axis: null },
    },
    layer: [
      {
        mark: { type: "bar", height: { band: 0.7 } },
        encoding: {
          color: colorByLabel
            ? {
                field: "label",
                type: "nominal",
                legend: null,
                sort: labelOrder(data, "given"),
              }
            : {
                condition: { test: "datum.value < 0", value: "var(--loss)" },
                value: "var(--chart-3)",
              },
        },
      },
      // Each value at its bar's end: past it to the right, or to the left of
      // a negative one.
      {
        transform: [{ filter: "datum.value >= 0" }],
        mark: { type: "text", align: "left", dx: 4 },
        encoding: { text: { field: "shown" } },
      },
      {
        transform: [{ filter: "datum.value < 0" }],
        mark: { type: "text", align: "right", dx: -4 },
        encoding: { text: { field: "shown" } },
      },
    ],
  };
}

// What the assets split into, in the order the app lists them.
export const distributionSpec = (data: readonly ChartDatum[]) =>
  horizontalBars(data, { sort: "given", colorByLabel: true });

// The largest holdings first.
export const rankingSpec = (data: readonly ChartDatum[]) =>
  horizontalBars(data, { sort: "largest", colorByLabel: false });

// What is owed on each debt, the largest first.
export const debtsSpec = (data: readonly ChartDatum[]) =>
  horizontalBars(data, { sort: "largest", colorByLabel: false });

// What is expected each month, in month order, its value over each bar.
export function incomeSpec(data: readonly ChartDatum[]): TopLevelSpec {
  return {
    $schema: SCHEMA,
    width: "container",
    height: 180,
    data: { values: plotted(data) },
    encoding: {
      x: {
        field: "label",
        type: "ordinal",
        sort: labelOrder(data, "given"),
        axis: { labelAngle: 0 },
      },
      y: {
        field: "value",
        type: "quantitative",
        axis: { format: "~s", grid: true },
      },
    },
    layer: [
      {
        mark: { type: "bar", width: { band: 0.6 } },
        encoding: {
          color: {
            condition: { test: "datum.value < 0", value: "var(--loss)" },
            value: "var(--chart-3)",
          },
        },
      },
      {
        mark: { type: "text", baseline: "bottom", dy: -4 },
        encoding: { text: { field: "shown" } },
      },
    ],
  };
}

// Net worth at each month's end as an area, and, when given, what was put in
// so far as a dashed line on the same axis.
export function netWorthSpec(
  data: readonly ChartDatum[],
  contributed?: readonly ChartDatum[],
): TopLevelSpec {
  const series = [
    ...plotted(data).map((each) => ({ ...each, series: "Patrimonio neto" })),
    ...plotted(contributed ?? []).map((each) => ({
      ...each,
      series: "Lo que pusiste",
    })),
  ];
  const x = {
    field: "label",
    type: "ordinal" as const,
    sort: labelOrder(data, "given"),
    axis: { labelAngle: 0, labelOverlap: "greedy" as const },
  };
  const y = {
    field: "value",
    type: "quantitative" as const,
    scale: { zero: false },
    axis: { format: "~s", grid: true, tickCount: 4 },
  };
  return {
    $schema: SCHEMA,
    width: "container",
    height: 200,
    data: { values: series },
    encoding: { x, y },
    layer: [
      {
        transform: [{ filter: "datum.series === 'Patrimonio neto'" }],
        mark: {
          type: "area",
          color: "var(--chart-3)",
          line: { color: "var(--chart-3)" },
        },
      },
      ...(contributed && contributed.length > 0
        ? [
            {
              transform: [{ filter: "datum.series === 'Lo que pusiste'" }],
              mark: {
                type: "line" as const,
                strokeDash: [4, 3],
                strokeWidth: 1.5,
                color: "var(--muted-foreground)",
              },
            },
          ]
        : []),
    ],
  };
}

// The spec of a template for its figures.
export function templateSpec(
  template: ChartTemplate,
  data: readonly ChartDatum[],
): TopLevelSpec {
  switch (template) {
    case "distribution":
      return distributionSpec(data);
    case "ranking":
      return rankingSpec(data);
    case "debts":
      return debtsSpec(data);
    case "income":
      return incomeSpec(data);
    case "net_worth":
      return netWorthSpec(data);
  }
}
