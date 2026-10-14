"use client";

import type { Denominator } from "@plant/core";

import { VegaChart } from "@/components/charts/vega-chart";
import { netWorthSpec } from "@/lib/charts/templates";
import { formatAmount } from "@/lib/format/amount";
import { monthInText } from "@/lib/summary/closes";

type Point = { period: string; value: string; contributed: string };

const SHORT_MONTH = new Intl.DateTimeFormat("es-AR", {
  month: "short",
  year: "2-digit",
  timeZone: "UTC",
});

// "2026-09" as "sept 26".
const shortMonth = (period: string) =>
  SHORT_MONTH.format(new Date(`${period}-01T00:00:00Z`)).replace(".", "");

// Net worth at the end of each month, beside what was put in so far, on one
// axis. A chart's numbers come from the closes; the chart only places them.
export function NetWorthChart({
  points,
  unit,
}: {
  points: Point[];
  unit: Denominator;
}) {
  if (points.length < 2) return null;
  const last = points.at(-1)!;
  const datum = (point: Point, key: "value" | "contributed") => ({
    label: shortMonth(point.period),
    value: point[key],
    shown: formatAmount(point[key], unit),
  });
  return (
    <figure className="m-0 grid gap-2">
      <VegaChart
        spec={netWorthSpec(
          points.map((point) => datum(point, "value")),
          points.map((point) => datum(point, "contributed")),
        )}
        label={`Patrimonio de ${monthInText(points[0]!.period)} a ${monthInText(last.period)}: termina en ${formatAmount(last.value, unit)}.`}
        className="min-h-52"
      />
      <figcaption className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="bg-chart-3 h-0.5 w-4 rounded" />
          Patrimonio neto a fin de mes
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
