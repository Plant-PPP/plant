"use client";

import { DENOMINATORS, type Denominator } from "@plant/core";
import { exactOf, plus, toDecimal } from "@plant/shared";
import Link from "next/link";
import { useId } from "react";

import { AssetsSummary } from "@/components/holdings/assets-summary";
import { useAssetsUrl } from "@/components/holdings/assets-url";
import { FilterSelect } from "@/components/holdings/filter-select";
import { AmountText, SummaryTile } from "@/components/holdings/sum-text";
import { unitParam } from "@/lib/holdings/assets-filter";
import { UNIT_LABELS } from "@/lib/holdings/messages";
import type { HoldingsValuation } from "@/lib/holdings/valuation-view";
import {
  type MonthClose,
  monthName,
  type YearClose,
} from "@/lib/summary/closes";
import type { KeysetParams } from "@/lib/supabase/keyset";
import { cn } from "@/lib/utils";

import { ClosesTable } from "./closes-table";
import { CloseStatus, ResultText } from "./figures";
import { NetWorthChart } from "./net-worth-chart";

// The months the chart shows, back from the one in progress.
const CHART_MONTHS = 24;

// Each month's end value beside what was put in so far: the first month's
// start plus every month's contributions up to it.
function chartPoints(closes: readonly MonthClose[]) {
  let putIn = exactOf(closes[0]?.figures.startValue ?? "0");
  return closes.map((close) => {
    putIn = plus(putIn, exactOf(close.figures.contributed));
    return {
      period: close.period,
      value: close.figures.endValue,
      contributed: toDecimal(putIn, 8),
    };
  });
}

// The whole net worth today, how it is split, how it moved month by month,
// and each month's and year's close.
export function SummaryPage({
  closes,
  years,
  year,
  valuation,
  unit,
  referenceUnit,
  params,
  closeHref,
  yearHref,
}: {
  // Every month, oldest first, the last one in progress.
  closes: MonthClose[];
  // Newest first.
  years: YearClose[];
  // The year the closes table shows.
  year: YearClose | undefined;
  valuation: Pick<HoldingsValuation, "kinds" | "classes">;
  unit: Denominator;
  referenceUnit: Denominator;
  params: KeysetParams;
  closeHref: (period: string) => string;
  yearHref: (year: string) => string;
}) {
  const url = useAssetsUrl(params);
  const id = useId();
  const current = closes.at(-1);
  const thisYear = years[0];
  const points = chartPoints(closes);

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="grid gap-1">
          <h1 className="text-xl font-semibold">Resumen</h1>
          <p className="text-muted-foreground text-sm">
            Tu patrimonio y cómo se movió mes a mes
          </p>
        </div>
        <FilterSelect
          id={`${id}-unit`}
          label="Valuar en"
          value={unit}
          pending={false}
          options={(Object.keys(DENOMINATORS) as Denominator[]).map(
            (each) => [each, UNIT_LABELS[each]] as const,
          )}
          onChange={(value) => url.set("unit", unitParam(value, referenceUnit))}
        />
      </div>

      {current && thisYear && (
        <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <SummaryTile label="Patrimonio" note="Hoy">
            <AmountText amount={current.figures.endValue} unit={unit} />
          </SummaryTile>
          <SummaryTile
            label={monthName(current.period)}
            note="Resultado del mes en curso"
          >
            <ResultText
              amount={current.figures.result}
              share={current.figures.share}
              unit={unit}
            />
          </SummaryTile>
          <SummaryTile
            label={`En ${thisYear.year}`}
            note="Resultado y rendimiento sin aportes"
          >
            <ResultText
              amount={thisYear.totals.result}
              share={thisYear.totals.share}
              unit={unit}
            />
          </SummaryTile>
          <SummaryTile
            label={`Aportes en ${thisYear.year}`}
            note="Compras menos ventas"
          >
            <AmountText amount={thisYear.totals.contributed} unit={unit} />
          </SummaryTile>
        </dl>
      )}

      <NetWorthChart points={points.slice(-CHART_MONTHS)} unit={unit} />

      <section className="grid gap-3" aria-labelledby={`${id}-split`}>
        <h2 id={`${id}-split`} className="text-base font-semibold">
          Cómo está repartido
        </h2>
        <AssetsSummary valuation={valuation} unit={unit} pending={false} />
      </section>

      <section className="grid gap-3" aria-labelledby={`${id}-closes`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id={`${id}-closes`} className="text-base font-semibold">
            Cierres
          </h2>
          <nav aria-label="Años" className="flex gap-1">
            {years.map((each) => (
              <button
                key={each.year}
                type="button"
                aria-current={each.year === year?.year || undefined}
                onClick={() =>
                  url.set(
                    "year",
                    each.year === years[0]?.year ? null : each.year,
                  )
                }
                className={cn(
                  "rounded-md px-2.5 py-1 text-sm tabular-nums",
                  each.year === year?.year
                    ? "bg-muted font-medium"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {each.year}
              </button>
            ))}
          </nav>
        </div>
        <p className="text-muted-foreground text-xs">
          Cada mes se cierra solo cuando termina. Si cargás o cambiás algo de un
          mes cerrado, su cierre se recalcula.
        </p>
        {year && (
          <>
            <ClosesTable year={year} unit={unit} href={closeHref} />
            <p className="text-sm">
              <Link
                href={yearHref(year.year)}
                className="underline-offset-2 hover:underline"
              >
                {`Ver el cierre de ${year.year}`}
              </Link>
              {year.open && (
                <span className="ml-2 align-middle">
                  <CloseStatus close={{ open: true, recalculatedOn: null }} />
                </span>
              )}
            </p>
          </>
        )}
      </section>
    </div>
  );
}
