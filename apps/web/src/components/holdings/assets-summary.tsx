import type { Denominator } from "@plant/core";
import { compareDecimals } from "@plant/shared";

import {
  HOLDING_CLASS_GROUP_LABELS,
  type HoldingClass,
} from "@/lib/holdings/classes";
import { inSentence } from "@/lib/format/text";
import { UNIT_LABELS } from "@/lib/holdings/messages";
import type {
  HoldingKind,
  HoldingsValuation,
} from "@/lib/holdings/valuation-view";
import { cn } from "@/lib/utils";

import { MissingFigure, NO_QUOTE, PendingSum, ShareText } from "./sum-text";
import { StatGrid, StatTile } from "@/components/ui/stat-tile";

const KINDS: { kind: HoldingKind | "total"; label: string }[] = [
  { kind: "total", label: "Total" },
  { kind: "cash", label: "Efectivo" },
  { kind: "investments", label: "Inversiones" },
  { kind: "other", label: "Otros activos" },
];

// The distribution bar's classes, each with its chart color.
const CLASS_COLORS: Record<HoldingClass, string> = {
  real_estate: "bg-chart-1",
  crypto: "bg-chart-2",
  cedear: "bg-chart-5",
  stock: "bg-chart-5/60",
  etf: "bg-chart-5/30",
  bond: "bg-chart-6",
  fci: "bg-chart-7",
  cash: "bg-chart-3",
  fixed_term: "bg-chart-8",
  other: "bg-chart-4",
};

// A unit's name inside a sentence: "dólar MEP", "pesos".
const unitName = (unit: Denominator) => inSentence(UNIT_LABELS[unit]);

// The shown holdings' total and its split by kind, each part with its share;
// the total names its unit and how many holdings it leaves out for lack of a
// quote. Below, the split by class as one bar.
export function AssetsSummary({
  valuation: { kinds, classes },
  unit,
  pending,
  totalLabel = "Total",
}: {
  valuation: Pick<HoldingsValuation, "kinds" | "classes">;
  unit: Denominator;
  pending: boolean;
  // The total tile's label: "Activos" where a net worth is shown beside it.
  totalLabel?: string;
}) {
  const parts = (Object.keys(CLASS_COLORS) as HoldingClass[])
    .flatMap((holdingClass) => {
      const share = classes[holdingClass]?.share;
      return share != null && compareDecimals(share, "0") > 0
        ? [
            {
              holdingClass,
              share,
              label: HOLDING_CLASS_GROUP_LABELS[holdingClass],
              color: CLASS_COLORS[holdingClass],
            },
          ]
        : [];
    })
    .sort((a, b) => compareDecimals(b.share, a.share));

  return (
    <div className="grid gap-4">
      <StatGrid>
        {KINDS.map(({ kind, label }) => (
          <StatTile
            key={kind}
            label={kind === "total" ? totalLabel : label}
            note={
              kind === "total" ? (
                `Valuado en ${unitName(unit)}${
                  kinds.total.missing > 0
                    ? ` · ${kinds.total.missing} sin cotización`
                    : ""
                }`
              ) : kinds[kind].count === 0 ? undefined : kinds[kind].missing ===
                kinds[kind].count ? (
                NO_QUOTE
              ) : (
                <ShareText
                  share={kinds[kind].share}
                  complete={kinds[kind].complete && kinds.total.complete}
                />
              )
            }
          >
            {/* A tile's figure is a number or a dash; that nothing has a
                quote is the note's to say. */}
            {kinds[kind].count > 0 &&
            kinds[kind].missing === kinds[kind].count ? (
              <MissingFigure text={NO_QUOTE} />
            ) : (
              <PendingSum sum={kinds[kind]} unit={unit} pending={pending} />
            )}
          </StatTile>
        ))}
      </StatGrid>
      {parts.length > 0 && (
        <figure className="m-0 grid gap-2">
          <div
            className={cn(
              "bg-muted flex h-2 overflow-hidden rounded-full",
              pending && "opacity-60",
            )}
            aria-hidden
          >
            {parts.map((part) => (
              <span
                key={part.holdingClass}
                className={part.color}
                style={{ width: `${part.share}%` }}
              />
            ))}
          </div>
          <figcaption className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs">
            {parts.map((part) => (
              <span
                key={part.holdingClass}
                className="inline-flex items-center gap-1.5"
              >
                <span
                  aria-hidden
                  className={cn("size-2 rounded-xs", part.color)}
                />
                {part.label}
                <span className="text-foreground font-medium tabular-nums">
                  <ShareText
                    share={part.share}
                    complete={kinds.total.complete}
                  />
                </span>
              </span>
            ))}
          </figcaption>
        </figure>
      )}
    </div>
  );
}
