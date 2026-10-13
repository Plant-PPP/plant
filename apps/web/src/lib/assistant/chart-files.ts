import { compareDecimals } from "@plant/shared";

import { formatAmount, shownSign } from "@/lib/format/amount";
import { formatDate } from "@/lib/format/date";
import { toCsv } from "@/lib/export/csv";
import { folded } from "@/lib/format/text";
import { UNIT_LABELS } from "@/lib/holdings/messages";

import type { ChartPart } from "./chat";

// "Datos al 12/10/2026 en Dólar MEP", under every chart and in its image.
export const chartCaption = (chart: ChartPart, asOf: string): string =>
  `Datos al ${formatDate(asOf)} en ${UNIT_LABELS[chart.unit]}`;

// A chart's points as a CSV: what each is and its value, as a plain decimal.
export const chartCsv = (chart: ChartPart): string =>
  toCsv(
    ["Concepto", `Valor (${UNIT_LABELS[chart.unit]})`],
    chart.points.map(({ label, value }) => [label, value]),
  );

// "resultado-por-mes-de-2026.csv".
export const chartFileName = (chart: ChartPart, extension: string): string =>
  `${
    folded(chart.title)
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "grafico"
  }.${extension}`;

const magnitude = (value: string) => value.replace(/^-/, "");

// The largest magnitude among the points, which a bar of full length shows.
export function largest(chart: ChartPart): string {
  return chart.points.reduce(
    (max, { value }) =>
      compareDecimals(magnitude(value), max) > 0 ? magnitude(value) : max,
    "0",
  );
}

// A bar's length as a share of the full one, from 0 to 1. It only places the
// bar on screen.
export const barShare = (value: string, top: string): number =>
  Number(top) === 0 ? 0 : Number(magnitude(value)) / Number(top);

// Where each point of a line sits in a `width` by `height` box, the first at
// the left edge and the last at the right, the lowest value at the bottom and
// the highest at the top; a flat line runs through the middle.
export function linePoints(
  chart: ChartPart,
  width: number,
  height: number,
): { x: number; y: number }[] {
  const values = chart.points.map(({ value }) => Number(value));
  const low = Math.min(...values);
  const high = Math.max(...values);
  const step = values.length > 1 ? width / (values.length - 1) : 0;
  return values.map((value, index) => ({
    x: values.length > 1 ? index * step : width / 2,
    y: high === low ? height / 2 : ((high - value) / (high - low)) * height,
  }));
}

export const PNG_SIZE = { width: 800, height: 480 } as const;

const INK = "#1f2937";
const MUTED = "#6b7280";
const BAR = "#3b82f6";
const LOSS = "#dc2626";

// The chart as an image: its title, its bars or line with their values, and
// the caption with the date and unit, on white.
export function drawChart(
  context: CanvasRenderingContext2D,
  chart: ChartPart,
  caption: string,
) {
  const { width, height } = PNG_SIZE;
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.fillStyle = INK;
  context.font = "bold 20px sans-serif";
  context.fillText(chart.title, 24, 36);
  context.fillStyle = MUTED;
  context.font = "13px sans-serif";
  context.fillText(caption, 24, height - 16);

  const top = 64;
  const bottom = height - 48;
  context.font = "13px sans-serif";
  if (chart.kind === "bars") {
    const max = largest(chart);
    const row = (bottom - top) / Math.max(chart.points.length, 1);
    const start = 220;
    const span = width - start - 170;
    chart.points.forEach(({ label, value }, index) => {
      const y = top + index * row;
      context.fillStyle = INK;
      context.fillText(label, 24, y + row / 2 + 4, start - 36);
      context.fillStyle = shownSign(value, chart.unit) < 0 ? LOSS : BAR;
      context.fillRect(
        start,
        y + row * 0.25,
        Math.max(barShare(value, max) * span, 1),
        row * 0.5,
      );
      context.fillStyle = INK;
      context.fillText(
        formatAmount(value, chart.unit),
        start + span + 12,
        y + row / 2 + 4,
      );
    });
    return;
  }
  const left = 24;
  const plotWidth = width - left - 24;
  const plotHeight = bottom - top - 40;
  const placed = linePoints(chart, plotWidth, plotHeight);
  context.strokeStyle = BAR;
  context.lineWidth = 3;
  context.beginPath();
  placed.forEach(({ x, y }, index) =>
    index === 0
      ? context.moveTo(left + x, top + 20 + y)
      : context.lineTo(left + x, top + 20 + y),
  );
  context.stroke();
  context.fillStyle = INK;
  chart.points.forEach(({ label, value }, index) => {
    const { x, y } = placed[index]!;
    context.fillRect(left + x - 3, top + 20 + y - 3, 6, 6);
    context.fillText(label, left + x - 16, bottom + 4, 64);
    if (index === 0 || index === chart.points.length - 1) {
      context.fillText(
        formatAmount(value, chart.unit),
        Math.min(left + x, width - 160),
        top + 20 + y - 10,
      );
    }
  });
}
