"use client";

import { type PinnedChart, PinnedCharts } from "./pinned-charts";
import type { Denominator } from "@plant/core";
import { exactOf, plus, stored } from "@plant/shared";
import Link from "next/link";
import type * as React from "react";
import { useId } from "react";

import { AccountsBreakdown } from "@/components/holdings/accounts-breakdown";
import { type ScopeHrefs, scopeLink } from "@/lib/holdings/scope-hrefs";
import { AssetsSummary } from "@/components/holdings/assets-summary";
import { useAssetsUrl } from "@/components/holdings/assets-url";
import { FilterSelect, UnitSelect } from "@/components/holdings/filter-select";
import { MepNotice } from "@/components/holdings/mep-notice";
import { PortfoliosBreakdown } from "@/components/holdings/portfolios-breakdown";
import { AmountText, SummaryTile } from "@/components/holdings/sum-text";
import type { PriceAlert } from "@/lib/alerts/alerts";
import type { HoldingRow } from "@/lib/holdings/read";
import type { HoldingsValuation } from "@/lib/holdings/valuation-view";
import {
  CLOSE_UNITS,
  closeHref,
  type MonthClose,
  monthName,
  type YearClose,
} from "@/lib/summary/closes";
import type { KeysetParams } from "@/lib/supabase/keyset";
import { cn } from "@/lib/utils";

import { ClosesTable } from "./closes-table";
import { CurrenciesBreakdown } from "./currencies-breakdown";
import { MetAlerts } from "./met-alerts";
import { PrintButton } from "./print-button";
import { CloseStatus, ResultText } from "./figures";
import { NetWorthChart } from "./net-worth-chart";

// The portfolio select's value for every portfolio.
const ALL = "all";

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
      contributed: stored(putIn),
    };
  });
}

// The whole net worth today, how it is split, how it moved month by month,
// and each month's and year's close. One portfolio shows only its assets
// today: debts belong to no portfolio, and closes are of the whole.
export function SummaryPage({
  closes,
  years,
  year,
  rows,
  valuation,
  portfolios,
  portfolio,
  unit,
  referenceUnit,
  params,
  hrefs,
  closesQuery,
  pinned = [],
  onUnpin,
  metAlerts = [],
  onAlertSeen,
}: {
  // Every month, oldest first, the last one in progress.
  closes: MonthClose[];
  // Newest first.
  years: YearClose[];
  // The year the closes table shows.
  year: YearClose | undefined;
  // The holdings shown, those of the chosen portfolio or all, and their
  // valuation.
  rows: readonly HoldingRow[];
  valuation: HoldingsValuation;
  // The active portfolios, and the one chosen; null for all of them.
  portfolios: readonly { id: string; name: string }[];
  portfolio: { id: string; name: string } | null;
  unit: Denominator;
  referenceUnit: Denominator;
  params: KeysetParams;
  hrefs?: Pick<ScopeHrefs, "account" | "portfolio">;
  // The query a close's page keeps, from closesQuery.
  closesQuery: string;
  // The assistant's charts the user pinned, drawn again, and the way to let
  // one go.
  pinned?: readonly PinnedChart[];
  onUnpin?: (id: string) => Promise<boolean>;
  // The price alerts met and not seen yet, and the way to mark one seen.
  metAlerts?: readonly PriceAlert[];
  onAlertSeen?: (id: string) => Promise<boolean>;
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
            {portfolio
              ? `Los activos de ${portfolio.name} hoy`
              : "Tu patrimonio neto y cómo se movió mes a mes"}
          </p>
        </div>
        <div
          className="flex w-full flex-wrap items-end gap-2 sm:w-auto"
          data-print="hidden"
        >
          <FilterSelect
            id={`${id}-portfolio`}
            label="Cartera"
            value={portfolio?.id ?? ALL}
            pending={false}
            options={[
              [ALL, "Todas las carteras"],
              ...portfolios.map((each) => [each.id, each.name] as const),
            ]}
            onChange={(value) =>
              url.set("portfolio", value === ALL ? null : value)
            }
          />
          <UnitSelect
            id={`${id}-unit`}
            unit={unit}
            referenceUnit={referenceUnit}
            units={CLOSE_UNITS}
            pending={false}
            onChange={(param) => url.set("unit", param)}
          />
          <PrintButton />
        </div>
      </div>
      {onAlertSeen && <MetAlerts alerts={metAlerts} onSeen={onAlertSeen} />}
      <MepNotice unit={unit} />

      {portfolio ? (
        <>
          <AssetsSummary valuation={valuation} unit={unit} pending={false} />
          <Split id={`${id}-accounts`} title="Por cuenta">
            <AccountsBreakdown
              rows={rows}
              accounts={valuation.accounts}
              whole={valuation.kinds}
              unit={unit}
              pending={false}
              href={scopeLink(hrefs, "account")}
            />
          </Split>
          <Split id={`${id}-currencies`} title="Por moneda">
            <CurrenciesBreakdown
              currencies={valuation.currencies}
              total={valuation.kinds.total}
              unit={unit}
            />
          </Split>
          <p className="text-muted-foreground text-xs">
            El patrimonio neto, su evolución y los cierres se ven con todas las
            carteras: las deudas no son de ninguna.
          </p>
        </>
      ) : (
        wholeSummary()
      )}
    </div>
  );

  // All portfolios: the net worth, its months and closes, and every split.
  function wholeSummary() {
    return (
      <>
        {current && thisYear && (
          <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <SummaryTile
              label="Patrimonio neto"
              note={
                current.endComplete
                  ? "Activos menos deudas, hoy"
                  : "Activos menos deudas, hoy, sin lo que no tiene cotización"
              }
            >
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
              note="Lo que entró menos lo que salió"
            >
              <AmountText amount={thisYear.totals.contributed} unit={unit} />
            </SummaryTile>
          </dl>
        )}

        <NetWorthChart points={points.slice(-CHART_MONTHS)} unit={unit} />

        {onUnpin && <PinnedCharts pinned={pinned} onUnpin={onUnpin} />}

        <section className="grid gap-3" aria-labelledby={`${id}-split`}>
          <h2 id={`${id}-split`} className="text-base font-semibold">
            Cómo está repartido
          </h2>
          <AssetsSummary valuation={valuation} unit={unit} pending={false} />
        </section>

        <Split id={`${id}-portfolios`} title="Por cartera">
          <PortfoliosBreakdown
            rows={rows}
            portfolios={valuation.portfolios}
            total={valuation.kinds.total}
            unit={unit}
            pending={false}
            href={scopeLink(hrefs, "portfolio")}
          />
        </Split>
        <Split id={`${id}-accounts`} title="Por cuenta">
          <AccountsBreakdown
            rows={rows}
            accounts={valuation.accounts}
            whole={valuation.kinds}
            unit={unit}
            pending={false}
            href={scopeLink(hrefs, "account")}
          />
        </Split>
        <Split id={`${id}-currencies`} title="Por moneda">
          <CurrenciesBreakdown
            currencies={valuation.currencies}
            total={valuation.kinds.total}
            unit={unit}
          />
        </Split>

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
            Cada mes se cierra solo cuando termina. Si cargás o cambiás algo de
            un mes cerrado, su cierre se recalcula.
          </p>
          {year && (
            <>
              <ClosesTable
                year={year}
                unit={unit}
                href={(period) => closeHref(period, closesQuery)}
              />
              <p className="text-sm">
                <Link
                  href={closeHref(year.year, closesQuery)}
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
      </>
    );
  }
}

// One way the assets are split, under its heading.
function Split({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="grid gap-3" aria-labelledby={id}>
      <h2 id={id} className="text-base font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}
