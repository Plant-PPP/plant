import { compareDecimals } from "@plant/shared";

import { formatAmount } from "@/lib/format/amount";
import type { ChartPart } from "@/lib/assistant/chat";
import { cn } from "@/lib/utils";

// An answer's chart: one bar per value, to scale from 0 to the largest
// magnitude, a loss drawn in red; each bar names its value.
export function AnswerChart({ chart }: { chart: ChartPart }) {
  const magnitude = (value: string) => value.replace(/^-/, "");
  const top = chart.bars.reduce(
    (max, bar) =>
      compareDecimals(magnitude(bar.value), max) > 0
        ? magnitude(bar.value)
        : max,
    "0",
  );
  // A bar's length only places it on screen.
  const width = (value: string) =>
    Number(top) === 0 ? 0 : (Number(magnitude(value)) / Number(top)) * 100;
  return (
    <figure className="m-0 grid gap-2 rounded-lg border p-3">
      <figcaption className="text-sm font-medium">{chart.title}</figcaption>
      <ul className="grid gap-1.5">
        {chart.bars.map((bar, index) => (
          <li
            // Two debts may share a label.
            key={index}
            className="grid grid-cols-[minmax(0,6rem)_minmax(0,1fr)_auto] items-center gap-2 text-xs"
          >
            <span className="text-muted-foreground truncate">{bar.label}</span>
            <span className="bg-muted h-2 overflow-hidden rounded-full">
              <span
                className={cn(
                  "block h-full rounded-full",
                  bar.value.startsWith("-") ? "bg-destructive" : "bg-chart-3",
                )}
                style={{ width: `${width(bar.value)}%` }}
              />
            </span>
            <span className="tabular-nums">
              {formatAmount(bar.value, chart.unit)}
            </span>
          </li>
        ))}
      </ul>
    </figure>
  );
}
