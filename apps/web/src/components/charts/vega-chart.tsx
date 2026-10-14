"use client";

import { useTheme } from "next-themes";
import { useEffect, useMemo, useRef, useState } from "react";
import type { TopLevelSpec } from "vega-lite";

import { d3FormatLocale } from "@/lib/charts/format-locale";
import { chartConfig, type ChartColors } from "@/lib/charts/theme";
import { cn } from "@/lib/utils";

// Vega and Vega-Lite load on the first chart, never on the server: their
// modules need the browser and weigh more than any page.
let loaded: Promise<{
  embed: typeof import("vega-embed").default;
  compile: typeof import("vega-lite").compile;
}> | null = null;
const load = () =>
  (loaded ??= Promise.all([import("vega-embed"), import("vega-lite")]).then(
    ([embed, lite]) => ({ embed: embed.default, compile: lite.compile }),
    // A load that failed, as a chunk lost to a deploy, is tried again by the
    // next chart.
    (error: unknown) => {
      loaded = null;
      throw error;
    },
  ));

const FORMAT_LOCALE = d3FormatLocale("es-AR");

const FAILED = "No pudimos mostrar este gráfico.";

// A CSS color the page defines, as the browser paints it: Vega draws SVG
// attributes, which take no var().
function cssColor(name: string): string {
  const probe = document.createElement("span");
  probe.style.color = `var(${name})`;
  probe.style.display = "none";
  document.body.appendChild(probe);
  const color = getComputedStyle(probe).color;
  probe.remove();
  return color;
}

// The page's chart colors and fonts for the current theme.
function pageColors(dark: boolean): ChartColors {
  const body = getComputedStyle(document.body);
  return {
    dark,
    palette: Array.from({ length: 8 }, (_, index) =>
      cssColor(`--chart-${index + 1}`),
    ),
    loss: cssColor("--loss"),
    muted: cssColor("--muted-foreground"),
    grid: cssColor("--border"),
    sans: body.fontFamily,
    mono:
      body.getPropertyValue("--font-geist-mono").trim() ||
      "ui-monospace, monospace",
  };
}

// The spec with every "var(--name)" string replaced by the color it names;
// its data, which only labels and places marks, is left as it is.
function resolved<T>(value: T): T {
  if (typeof value === "string") {
    const name = /^var\((--[\w-]+)\)$/.exec(value)?.[1];
    return (name ? cssColor(name) : value) as T;
  }
  if (Array.isArray(value)) return value.map(resolved) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, each]) => [
        key,
        key === "data" ? each : resolved(each),
      ]),
    ) as T;
  }
  return value;
}

// A Vega-Lite chart in Plant's theme, as SVG, as wide as its box and redrawn
// when the theme changes. Specs are compiled and run without eval (`ast`),
// which the CSP forbids. `label` names the chart for a screen reader, which
// reads the figures from the text beside it.
export function VegaChart({
  spec,
  label,
  className,
}: {
  spec: TopLevelSpec;
  label: string;
  className?: string;
}) {
  // Vega takes over the box it draws in, so the chart's name stays on the
  // one around it.
  const box = useRef<HTMLDivElement>(null);
  const { resolvedTheme } = useTheme();
  const dark = resolvedTheme === "dark";
  const [failed, setFailed] = useState(false);
  const key = useMemo(() => JSON.stringify(spec), [spec]);

  useEffect(() => {
    const element = box.current;
    if (!element) return;
    let disposed = false;
    setFailed(false);
    let finalize: (() => void) | null = null;
    let observer: ResizeObserver | null = null;
    load()
      .then(async ({ embed, compile }) => {
        if (disposed) return;
        const colors = pageColors(dark);
        const themed = {
          ...resolved(JSON.parse(key) as TopLevelSpec),
          config: chartConfig(colors),
        } as TopLevelSpec;
        const result = await embed(element, compile(themed).spec, {
          actions: false,
          ast: true,
          mode: "vega",
          renderer: "svg",
          formatLocale: FORMAT_LOCALE,
          tooltip: false,
        });
        if (disposed) {
          result.finalize();
          return;
        }
        finalize = () => result.finalize();
        // A width of "container" follows only the window; the box may
        // change on its own, as the sidebar folds.
        observer = new ResizeObserver(() => {
          void result.view.width(element.clientWidth).runAsync();
        });
        observer.observe(element);
      })
      .catch(() => {
        if (!disposed) setFailed(true);
      });
    return () => {
      disposed = true;
      observer?.disconnect();
      finalize?.();
    };
  }, [key, dark]);

  // The box stays mounted, so a new spec or theme draws again after a
  // failure. A screen reader reads only the label of an img, so the failure
  // takes it.
  return (
    <div
      role="img"
      aria-label={failed ? FAILED : label}
      className={cn("w-full", className)}
    >
      {failed && <p className="text-muted-foreground text-xs">{FAILED}</p>}
      <div
        ref={box}
        aria-hidden
        hidden={failed}
        className="w-full [&_svg]:max-w-full"
      />
    </div>
  );
}
