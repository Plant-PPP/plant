"use client";

import { Download, ImageDown, Maximize2, Pin } from "lucide-react";
import { Component, type ReactNode, useRef, useState } from "react";
import { toast } from "sonner";

import { AppDialog } from "@/components/ui/app-dialog";
import { Button } from "@/components/ui/button";
import type { ChartPart } from "@/lib/assistant/chat";
import {
  chartCaption,
  chartCsv,
  chartFileName,
  drawChart,
  PNG_SIZE,
} from "@/lib/assistant/chart-files";
import { csvBlob, saveFile } from "@/lib/export/download";
import { VegaChart } from "@/components/charts/vega-chart";

import { usePin } from "./pin-context";
import { templateSpec } from "@/lib/charts/templates";
import { formatAmount } from "@/lib/format/amount";

// The chart drawn by its template, or by its kind when it names none, with
// each point's value in a list a screen reader reads.
function ChartBody({ chart }: { chart: ChartPart }) {
  const data = chart.points.map((point) => ({
    ...point,
    shown: formatAmount(point.value, chart.unit),
  }));
  const template =
    chart.template ?? (chart.kind === "line" ? "net_worth" : "bars");
  return (
    <div className="grid gap-1">
      <VegaChart spec={templateSpec(template, data)} label={chart.title} />
      <ul className="sr-only">
        {data.map((point, index) => (
          <li key={index}>{`${point.label}: ${point.shown}`}</li>
        ))}
      </ul>
    </div>
  );
}

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

const PIN_MESSAGES = {
  pinned: "Fijaste el gráfico en el Resumen.",
  already: "Ese gráfico ya está fijado en el Resumen.",
  full: "Ya fijaste el máximo de gráficos. Soltá alguno en el Resumen.",
  failed: "No pudimos fijar el gráfico. Probá de nuevo.",
} as const;

// An answer's chart: its title, the day and unit of its data, and actions to
// see it larger, save it as a CSV or an image, or pin it to Resumen.
export function ChartCard({ chart, asOf }: { chart: ChartPart; asOf: string }) {
  const [expanded, setExpanded] = useState(false);
  const pin = usePin();
  const [pinning, setPinning] = useState(false);
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
          {pin?.pins(chart) &&
            !pinning &&
            action("Fijar en el Resumen", <Pin />, () => {
              setPinning(true);
              void pin
                .pin(chart)
                .catch(() => "failed" as const)
                .then((result) => {
                  setPinning(false);
                  if (result === "pinned" || result === "already") {
                    toast.success(PIN_MESSAGES[result]);
                  } else toast.error(PIN_MESSAGES[result]);
                });
            })}
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
