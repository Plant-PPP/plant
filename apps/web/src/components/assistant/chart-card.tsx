"use client";

import { Download, ImageDown, Maximize2 } from "lucide-react";
import { Component, type ReactNode, useRef, useState } from "react";

import { AppDialog } from "@/components/ui/app-dialog";
import { Button } from "@/components/ui/button";
import type { ChartPart } from "@/lib/assistant/chat";
import {
  barShare,
  chartCaption,
  chartCsv,
  chartFileName,
  drawChart,
  largest,
  linePoints,
  PNG_SIZE,
} from "@/lib/assistant/chart-files";
import { csvBlob, saveFile } from "@/lib/export/download";
import { formatAmount, shownSign } from "@/lib/format/amount";
import { cn } from "@/lib/utils";

// One bar per value, to scale from 0 to the largest magnitude, a loss drawn
// in red; each bar names its value. The rows share their columns, so every
// bar's track is as long as the others.
function Bars({ chart }: { chart: ChartPart }) {
  const top = largest(chart);
  return (
    <ul className="grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)_auto] gap-x-2 gap-y-1.5">
      {chart.points.map((point, index) => (
        <li
          // Two debts may share a label.
          key={index}
          className="col-span-3 grid grid-cols-subgrid items-center text-xs"
        >
          <span className="text-muted-foreground leading-tight break-words">
            {point.label}
          </span>
          <span className="bg-muted h-2 overflow-hidden rounded-full">
            <span
              className={cn(
                "block h-full rounded-full",
                shownSign(point.value, chart.unit) < 0
                  ? "bg-destructive"
                  : "bg-chart-3",
              )}
              style={{ width: `${barShare(point.value, top) * 100}%` }}
            />
          </span>
          <span className="tabular-nums">
            {formatAmount(point.value, chart.unit)}
          </span>
        </li>
      ))}
    </ul>
  );
}

const LINE_WIDTH = 600;
const LINE_HEIGHT = 160;

// A line through the points in order, its first and last values named, and
// each point's value in a list a screen reader reads.
function Line({ chart }: { chart: ChartPart }) {
  const placed = linePoints(chart, LINE_WIDTH, LINE_HEIGHT);
  const first = chart.points[0];
  const last = chart.points.at(-1);
  return (
    <div className="grid gap-1">
      <svg
        viewBox={`-8 -8 ${LINE_WIDTH + 16} ${LINE_HEIGHT + 16}`}
        className="h-auto w-full"
        aria-hidden
      >
        <polyline
          points={placed.map(({ x, y }) => `${x},${y}`).join(" ")}
          fill="none"
          stroke="var(--chart-3)"
          strokeWidth={3}
          strokeLinejoin="round"
        />
        {placed.map(({ x, y }, index) => (
          <circle key={index} cx={x} cy={y} r={4} fill="var(--chart-3)" />
        ))}
      </svg>
      {first && last && (
        <div className="text-muted-foreground flex justify-between text-xs tabular-nums">
          <span>{`${first.label}: ${formatAmount(first.value, chart.unit)}`}</span>
          <span>{`${last.label}: ${formatAmount(last.value, chart.unit)}`}</span>
        </div>
      )}
      <ul className="sr-only">
        {chart.points.map((point, index) => (
          <li key={index}>
            {`${point.label}: ${formatAmount(point.value, chart.unit)}`}
          </li>
        ))}
      </ul>
    </div>
  );
}

const ChartBody = ({ chart }: { chart: ChartPart }) =>
  chart.kind === "line" ? <Line chart={chart} /> : <Bars chart={chart} />;

function savePng(chart: ChartPart, caption: string) {
  const canvas = document.createElement("canvas");
  canvas.width = PNG_SIZE.width;
  canvas.height = PNG_SIZE.height;
  const context = canvas.getContext("2d");
  if (!context) return;
  drawChart(context, chart, caption);
  canvas.toBlob((blob) => {
    if (blob) saveFile(chartFileName(chart, "png"), blob);
  }, "image/png");
}

// An answer's chart: its title, the day and unit of its data, and actions to
// see it larger or save it as a CSV or an image.
export function ChartCard({ chart, asOf }: { chart: ChartPart; asOf: string }) {
  const [expanded, setExpanded] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const caption = chartCaption(chart, asOf);
  const action = (
    label: string,
    icon: ReactNode,
    onClick: () => void,
    ref?: React.Ref<HTMLButtonElement>,
  ) => (
    <Button
      ref={ref}
      type="button"
      size="icon"
      variant="ghost"
      className="size-7"
      aria-label={`${label}: ${chart.title}`}
      title={label}
      onClick={onClick}
    >
      {icon}
    </Button>
  );
  return (
    <figure className="m-0 grid gap-2 rounded-lg border p-3">
      <div className="flex items-start justify-between gap-2">
        <figcaption className="grid gap-0.5">
          <span className="text-sm font-medium">{chart.title}</span>
          <span className="text-muted-foreground text-xs">{caption}</span>
        </figcaption>
        <div className="flex shrink-0">
          {action("Ampliar", <Maximize2 />, () => setExpanded(true), opener)}
          {action("Descargar CSV", <Download />, () =>
            saveFile(chartFileName(chart, "csv"), csvBlob(chartCsv(chart))),
          )}
          {action("Descargar imagen", <ImageDown />, () =>
            savePng(chart, caption),
          )}
        </div>
      </div>
      <ChartBody chart={chart} />
      {expanded && (
        <AppDialog
          onClose={() => setExpanded(false)}
          title={chart.title}
          description={caption}
          returnFocusTo={() => opener.current}
          className="sm:max-w-3xl"
        >
          <ChartBody chart={chart} />
        </AppDialog>
      )}
    </figure>
  );
}

// A chart that fails to draw says so in its place, leaving the answer whole.
export class ChartBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? (
      <p className="text-muted-foreground rounded-lg border p-3 text-xs">
        No pudimos mostrar este gráfico.
      </p>
    ) : (
      this.props.children
    );
  }
}
