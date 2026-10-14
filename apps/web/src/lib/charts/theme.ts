import type { Config } from "vega-lite";

// What a chart's theme reads from the page: the eight chart colors, the color
// of a loss, the muted text and grid lines, and the fonts, each resolved to a
// literal Vega can paint, since it cannot read a CSS variable.
export type ChartColors = {
  dark: boolean;
  palette: readonly string[];
  loss: string;
  muted: string;
  grid: string;
  sans: string;
  mono: string;
};

// Plant's look for every Vega-Lite chart: a transparent background, no axis
// lines but the x baseline, quiet grid lines, numbers in the mono font, and
// the chart colors in order. The theme wins over whatever a spec sets.
export function chartConfig(colors: ChartColors): Config {
  return {
    background: "transparent",
    font: colors.sans,
    // The chart's name is on its box and its figures in the text beside it;
    // marks described one by one would read raw numbers.
    aria: false,
    padding: 4,
    view: { stroke: "transparent" },
    axis: {
      labelColor: colors.muted,
      titleColor: colors.muted,
      gridColor: colors.grid,
      domain: false,
      ticks: false,
      title: null,
      labelFont: colors.mono,
      labelFontSize: 11,
      labelPadding: 8,
      labelOverlap: "greedy",
    },
    axisX: { domain: true, domainColor: colors.grid, grid: false },
    axisBand: { labelFont: colors.sans },
    legend: {
      orient: "bottom",
      direction: "horizontal",
      title: null,
      labelColor: colors.muted,
      labelFont: colors.sans,
      labelFontSize: 11,
      symbolType: "stroke",
    },
    text: { font: colors.mono, fontSize: 11, color: colors.muted },
    bar: { cornerRadiusEnd: 4 },
    area: { line: true, fillOpacity: 0.25 },
    line: { strokeWidth: 2.5 },
    range: { category: [...colors.palette] },
    mark: { invalid: "filter" },
  };
}
