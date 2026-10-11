import type { Denominator } from "@plant/core";
import { compareDecimals } from "@plant/shared";

import { formatAmount } from "@/lib/format/amount";
import { monthInText } from "@/lib/summary/closes";

type Point = { period: string; value: string; contributed: string };

const WIDTH = 640;
const HEIGHT = 200;
const PAD = { top: 16, right: 8, bottom: 6, left: 8 };

// Net worth at the end of each month, beside what was put in so far, to
// scale: both lines share one axis from the smallest value to the largest,
// both labelled. A chart's numbers come from the closes; the lines only place
// them.
export function NetWorthChart({
  points,
  unit,
}: {
  points: Point[];
  unit: Denominator;
}) {
  if (points.length < 2) return null;
  const values = points.flatMap((point) => [point.value, point.contributed]);
  const top = values.reduce((max, each) =>
    compareDecimals(each, max) > 0 ? each : max,
  );
  const bottom = values.reduce((min, each) =>
    compareDecimals(each, min) < 0 ? each : min,
  );
  // Positions on screen only: a pixel needs no exact decimal.
  const low = Number(bottom);
  const span = Number(top) - low || 1;
  const x = (index: number) =>
    PAD.left + (index * (WIDTH - PAD.left - PAD.right)) / (points.length - 1);
  const y = (value: string) =>
    PAD.top +
    (1 - (Number(value) - low) / span) * (HEIGHT - PAD.top - PAD.bottom);
  const line = (key: "value" | "contributed") =>
    points
      .map(
        (point, index) =>
          `${index === 0 ? "M" : "L"}${x(index)},${y(point[key])}`,
      )
      .join(" ");
  const last = points.at(-1)!;
  const yearTicks = points.flatMap((point, index) =>
    point.period.endsWith("-01")
      ? [{ index, label: point.period.slice(0, 4) }]
      : [],
  );

  return (
    <figure className="m-0 grid gap-2">
      <span className="text-muted-foreground text-[11px] tabular-nums">
        {formatAmount(top, unit)}
      </span>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-48 w-full"
        role="img"
        aria-label={`Patrimonio de ${monthInText(points[0]!.period)} a ${monthInText(last.period)}: termina en ${formatAmount(last.value, unit)}.`}
        preserveAspectRatio="none"
      >
        {yearTicks.map(({ index, label }) => (
          <g key={label}>
            <line
              x1={x(index)}
              x2={x(index)}
              y1={PAD.top}
              y2={HEIGHT - PAD.bottom}
              className="stroke-border"
              strokeDasharray="2 3"
              vectorEffect="non-scaling-stroke"
            />
          </g>
        ))}
        <path
          d={line("contributed")}
          fill="none"
          className="stroke-muted-foreground"
          strokeWidth={1.5}
          strokeDasharray="4 3"
          vectorEffect="non-scaling-stroke"
        />
        <path
          d={line("value")}
          fill="none"
          className="stroke-chart-3"
          strokeWidth={2.5}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      {/* The year labels sit outside the stretched drawing, so they keep
          their shape at any width; one near the right edge ends at its tick
          instead of running past the chart. */}
      <div aria-hidden className="relative h-3">
        {yearTicks.map(({ index, label }) => {
          const at = (x(index) / WIDTH) * 100;
          return (
            <span
              key={label}
              className="text-muted-foreground absolute top-0 text-[10px] tabular-nums"
              style={
                at > 90
                  ? { right: `calc(${100 - at}% + 4px)` }
                  : { left: `calc(${at}% + 4px)` }
              }
            >
              {label}
            </span>
          );
        })}
      </div>
      <span className="text-muted-foreground text-[11px] tabular-nums">
        {formatAmount(bottom, unit)}
      </span>
      <figcaption className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="bg-chart-3 h-0.5 w-4 rounded" />
          Patrimonio a fin de mes
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            aria-hidden
            className="border-muted-foreground w-4 border-t border-dashed"
          />
          Lo que pusiste
        </span>
      </figcaption>
    </figure>
  );
}
