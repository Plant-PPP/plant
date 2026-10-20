"use client";

import { type PinnedChart, PinnedCharts } from "./pinned-charts";
import type { Denominator } from "@plant/core";
import { compareDecimals, exactOf, plus, stored } from "@plant/shared";
import {
  CalendarCheck,
  ChartPie,
  Printer,
  TrendingUp,
  Upload,
} from "lucide-react";
import Link from "next/link";
import type * as React from "react";
import { Suspense, useId, useState } from "react";

import { AccountsBreakdown } from "@/components/holdings/accounts-breakdown";
import { type ScopeHrefs, scopeLink } from "@/lib/holdings/scope-hrefs";
import { AssetsSummary } from "@/components/holdings/assets-summary";
import { useAssetsUrl } from "@/components/holdings/assets-url";
import { FilterSelect, UnitSelect } from "@/components/holdings/filter-select";
import { PortfoliosBreakdown } from "@/components/holdings/portfolios-breakdown";
import { AmountText, missingQuotesText } from "@/components/holdings/sum-text";
import { EmptyState } from "@/components/ui/empty-state";
import { IconButton } from "@/components/ui/icon-button";
import { PageButton } from "@/components/ui/page-button";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { Section } from "@/components/ui/section";
import { Segmented } from "@/components/ui/segmented";
import { StatGrid, StatTile } from "@/components/ui/stat-tile";
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

import { ClosesTable } from "./closes-table";
import { CurrenciesBreakdown } from "./currencies-breakdown";
import { MetAlerts } from "./met-alerts";
import { ResultText } from "./figures";
import { NetWorthChart } from "./net-worth-chart";

// The portfolio select's value for every portfolio.
const ALL = "all";

// The months the chart shows, back from the one in progress.
const CHART_MONTHS = 24;

// The ways the assets are split, in the switcher's order.
const SPLITS = {
  portfolio: "Cartera",
  account: "Cuenta",
  currency: "Moneda",
} as const;
type Split = keyof typeof SPLITS;

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

// The whole net worth today, how it moved month by month, how it is split,
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
  alertsReadFailed = false,
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
  pinned?: readonly PinnedChart[] | Promise<readonly PinnedChart[]>;
  onUnpin?: (id: string) => Promise<boolean>;
  // The price alerts met and not seen yet, whether they could not be read,
  // and the way to mark one seen.
  metAlerts?: readonly PriceAlert[];
  alertsReadFailed?: boolean;
  onAlertSeen?: (id: string) => Promise<boolean>;
}) {
  const url = useAssetsUrl(params);
  const id = useId();
  const [split, setSplit] = useState<Split>("portfolio");
  const current = closes.at(-1);
  const thisYear = years[0];
  const points = chartPoints(closes);
  const { missing } = valuation.kinds.total;
  // Nothing loaded yet: no holdings, and no month that moved.
  const empty =
    rows.length === 0 &&
    closes.every(
      ({ figures }) =>
        compareDecimals(figures.endValue, "0") === 0 &&
        compareDecimals(figures.contributed, "0") === 0,
    );

  return (
    <div className="grid gap-8">
      <div className="grid gap-4">
        <PageHeader
          title="Resumen"
          filters={
            !empty && (
              <>
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
              </>
            )
          }
          actions={
            !empty && (
              <>
                <IconButton
                  icon={Printer}
                  size="toolbar"
                  tooltip="Guardar en PDF"
                  label="Guardar en PDF"
                  onClick={() => window.print()}
                />
              </>
            )
          }
        />
        {onAlertSeen && (
          <MetAlerts
            alerts={metAlerts}
            readFailed={alertsReadFailed}
            onSeen={onAlertSeen}
          />
        )}
        {missing > 0 && (
          <Notice
            variant="warning"
            action={
              <PageButton asChild data-print="hidden">
                <Link href="/assets">Ver en Activos</Link>
              </PageButton>
            }
          >
            {missingQuotesText(missing)}
          </Notice>
        )}
      </div>

      {empty ? (
        <EmptyState
          icon={Upload}
          title={
            portfolio
              ? `${portfolio.name} está vacía`
              : "Tu patrimonio, en un lugar"
          }
          actions={
            <PageButton asChild variant="default">
              <Link href="/import">Cargar un resumen</Link>
            </PageButton>
          }
        >
          {portfolio
            ? "Cuando cargues activos en esta cartera, los vas a ver acá."
            : "Subí el resumen de tu broker, una captura o un Excel: lo leemos, lo revisás y armamos tu patrimonio en pesos y en dólares."}
        </EmptyState>
      ) : portfolio ? (
        portfolioSummary()
      ) : (
        wholeSummary()
      )}
    </div>
  );

  // The split by portfolio, account or currency, one at a time on screen and
  // every one on paper.
  function splitSection(choices: readonly Split[], footnote?: string) {
    const panel = `${id}-split`;
    const shown = choices.includes(split) ? split : choices[0]!;
    const tables: Record<Split, React.ReactNode> = {
      portfolio: (
        <PortfoliosBreakdown
          rows={rows}
          portfolios={valuation.portfolios}
          total={valuation.kinds.total}
          unit={unit}
          pending={false}
          href={scopeLink(hrefs, "portfolio")}
        />
      ),
      account: (
        <AccountsBreakdown
          rows={rows}
          accounts={valuation.accounts}
          whole={valuation.kinds}
          unit={unit}
          pending={false}
          href={scopeLink(hrefs, "account")}
        />
      ),
      currency: (
        <CurrenciesBreakdown
          currencies={valuation.currencies}
          total={valuation.kinds.total}
          unit={unit}
        />
      ),
    };
    return (
      <Section
        title="Cómo está repartido"
        icon={ChartPie}
        description="Por tipo de activo y por clase, y dónde lo tenés"
      >
        <AssetsSummary
          valuation={valuation}
          unit={unit}
          pending={false}
          totalLabel={portfolio ? "Total" : "Activos"}
        />
        <div className="grid gap-2">
          <Segmented
            label="Ver por"
            options={choices.map((value) => ({ value, label: SPLITS[value] }))}
            value={shown}
            onChange={setSplit}
            controls={panel}
            className="print:hidden"
          />
          {choices.map((each) => (
            <div
              key={each}
              role="tabpanel"
              id={each === shown ? panel : undefined}
              aria-label={`Por ${SPLITS[each].toLowerCase()}`}
              hidden={each !== shown}
              data-print="shown"
              className="grid gap-2"
            >
              <h3 className="hidden text-sm font-semibold print:block">
                {`Por ${SPLITS[each].toLowerCase()}`}
              </h3>
              {tables[each]}
            </div>
          ))}
          {footnote && (
            <p className="text-muted-foreground text-xs">{footnote}</p>
          )}
        </div>
      </Section>
    );
  }

  // One portfolio: its assets today, split by account and currency.
  function portfolioSummary() {
    return splitSection(
      ["account", "currency"],
      "El patrimonio neto, su evolución y los cierres se ven con todas las carteras: las deudas no son de ninguna.",
    );
  }

  // All portfolios: the net worth and its months, every split, the closes
  // and the pinned charts.
  function wholeSummary() {
    return (
      <>
        {current && thisYear && (
          <StatGrid aria-label="Patrimonio neto">
            <StatTile
              label="Patrimonio neto"
              note={
                current.endComplete
                  ? "Activos menos deudas, hoy"
                  : "Activos menos deudas, sin lo que no tiene cotización"
              }
            >
              <AmountText amount={current.figures.endValue} unit={unit} />
            </StatTile>
            <StatTile
              label={monthName(current.period)}
              note="Resultado del mes en curso"
            >
              <ResultText
                amount={current.figures.result}
                share={current.figures.share}
                unit={unit}
              />
            </StatTile>
            <StatTile
              label={`En ${thisYear.year}`}
              note="Resultado y rendimiento sin aportes"
            >
              <ResultText
                amount={thisYear.totals.result}
                share={thisYear.totals.share}
                unit={unit}
              />
            </StatTile>
            <StatTile
              label={`Aportes en ${thisYear.year}`}
              note="Lo que entró menos lo que salió"
            >
              <AmountText amount={thisYear.totals.contributed} unit={unit} />
            </StatTile>
          </StatGrid>
        )}

        {points.length >= 2 && (
          <Section
            title="Evolución"
            icon={TrendingUp}
            description="Tu patrimonio neto a fin de cada mes, al lado de lo que pusiste"
          >
            <NetWorthChart points={points.slice(-CHART_MONTHS)} unit={unit} />
          </Section>
        )}

        {splitSection(["portfolio", "account", "currency"])}

        <Section
          title="Cierres"
          icon={CalendarCheck}
          description="Cada mes se cierra solo cuando termina. Si cargás o cambiás algo de un mes cerrado, su cierre se recalcula."
          actions={
            year &&
            years.length > 1 && (
              <Segmented
                label="Años"
                options={years.map((each) => ({
                  value: each.year,
                  label: each.year,
                }))}
                value={year.year}
                onChange={(next) =>
                  url.set("year", next === years[0]?.year ? null : next)
                }
                controls={`${id}-closes`}
                className="print:hidden"
              />
            )
          }
        >
          {year ? (
            <div
              role="tabpanel"
              id={`${id}-closes`}
              aria-label={`Cierres de ${year.year}`}
            >
              <ClosesTable
                year={year}
                unit={unit}
                href={(period) => closeHref(period, closesQuery)}
              />
            </div>
          ) : (
            <EmptyState icon={CalendarCheck} title="Todavía no hay cierres">
              Cada mes se cierra solo cuando termina: el primero aparece acá.
            </EmptyState>
          )}
        </Section>

        {onUnpin && (
          <Suspense fallback={null}>
            <PinnedCharts pinned={pinned} onUnpin={onUnpin} />
          </Suspense>
        )}
      </>
    );
  }
}
