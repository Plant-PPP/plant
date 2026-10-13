"use client";

import { type Denominator, referenceUnit } from "@plant/core";
import { notFound } from "next/navigation";

import {
  MonthCloseDetail,
  YearCloseDetail,
} from "@/components/summary/close-detail";
import { SummaryPage } from "@/components/summary/summary-page";
import { parseAssetsParams, TABS } from "@/lib/holdings/assets-filter";
import { currencyOf } from "@/lib/holdings/holding-name";
import { holdingsValuation } from "@/lib/holdings/valuation-view";
import { onboardingSteps } from "@/lib/onboarding/steps";
import { backYear, closesQuery, closeUnit } from "@/lib/summary/closes";
import { SCOPE_HREFS } from "@/lib/holdings/scope-hrefs";
import type { KeysetParams } from "@/lib/supabase/keyset";

import { closesOf, monthDetail, yearsOfCloses } from "@/lib/summary/compute";
import { usePrototype } from "./prototype-provider";
import { holdingsView, type PrototypeState } from "./prototype-store";

// The unit closes are shown in: ?unit= when closes have it, else the
// user's reference unit.
const closeUnitOf = (params: KeysetParams, reference: Denominator) =>
  closeUnit(
    parseAssetsParams(params, {
      portfolioIds: [],
      tabs: TABS,
      salesYears: [],
    }).unit,
    reference,
  );

// The unit Resumen and closes open in: the user's, when closes have it.
const summaryHome = (state: PrototypeState) =>
  closeUnit(state.preferredUnit, referenceUnit(state.referenceDollar));

// Resumen over the prototype's store.
export function PrototypeSummary({ params }: { params: KeysetParams }) {
  const { state, snapshot } = usePrototype();
  const reference = summaryHome(state);
  const unit = closeUnitOf(params, reference);
  const closes = closesOf(state, unit);
  const years = yearsOfCloses(closes);
  // The portfolio, ?portfolio= when it is one of the user's, and the year the
  // table shows, ?year=, else the newest.
  const { portfolios } = state;
  const {
    year,
    filter: { portfolioId },
  } = parseAssetsParams(params, {
    portfolioIds: portfolios.map((each) => each.id),
    tabs: TABS,
    salesYears: years.map((each) => each.year),
  });
  const portfolio = portfolios.find((each) => each.id === portfolioId) ?? null;
  const rows = holdingsView(state).active.filter(
    (row) => portfolio === null || row.portfolio.id === portfolio.id,
  );
  return (
    <SummaryPage
      closes={closes}
      years={years}
      year={years.find((each) => each.year === year)}
      rows={rows}
      valuation={holdingsValuation({
        holdings: rows,
        truncated: false,
        snapshot,
        unit,
        referenceDollar: state.referenceDollar,
        currencyOf: (holding) =>
          holding.asset_class === "instrument"
            ? currencyOf(state.instruments, holding.instrument_symbol)
            : holding.currency,
      })}
      portfolios={portfolios}
      portfolio={portfolio}
      unit={unit}
      referenceUnit={reference}
      params={params}
      hrefs={SCOPE_HREFS}
      onboarding={onboardingSteps({
        consentVersion: state.consent?.version ?? null,
        accounts: state.accounts.length,
        holdings: state.holdings.length,
        questions: state.askedOn.length,
      })}
      closesQuery={closesQuery(unit, reference)}
    />
  );
}

// A month's (2026-09) or a year's (2026) close over the prototype's store.
export function PrototypeClose({
  period,
  params,
}: {
  period: string;
  params: KeysetParams;
}) {
  const { state } = usePrototype();
  const reference = summaryHome(state);
  const unit = closeUnitOf(params, reference);
  const years = yearsOfCloses(closesOf(state, unit));
  const backHref = `/${closesQuery(unit, reference, backYear(period, years))}`;
  if (/^\d{4}$/.test(period)) {
    const year = years.find((each) => each.year === period);
    if (!year) notFound();
    return (
      <YearCloseDetail
        year={year}
        unit={unit}
        backHref={backHref}
        closesQuery={closesQuery(unit, reference)}
      />
    );
  }
  const detail = /^\d{4}-\d{2}$/.test(period)
    ? monthDetail(state, unit, period)
    : null;
  if (!detail) notFound();
  return <MonthCloseDetail detail={detail} unit={unit} backHref={backHref} />;
}
