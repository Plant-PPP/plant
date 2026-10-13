"use client";

import { type Denominator, referenceUnit } from "@plant/core";
import { notFound } from "next/navigation";

import {
  MonthCloseDetail,
  YearCloseDetail,
} from "@/components/summary/close-detail";
import { SummaryPage } from "@/components/summary/summary-page";
import {
  parseAssetsParams,
  TABS,
  unitParam,
} from "@/lib/holdings/assets-filter";
import { holdingsValuation } from "@/lib/holdings/valuation-view";
import { closeUnit } from "@/lib/summary/closes";
import type { KeysetParams } from "@/lib/supabase/keyset";

import { closesOf, monthDetail, yearsOfCloses } from "./prototype-closes";
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

// Resumen and a close's page, in the unit the user is looking at; Resumen
// back on the close's year unless it is the newest, which it shows anyway.
const linksIn = (unit: Denominator, reference: Denominator) => {
  const query = (year: string | null) => {
    const search = new URLSearchParams();
    const param = unitParam(unit, reference);
    if (param !== null) search.set("unit", param);
    if (year !== null) search.set("year", year);
    const text = search.toString();
    return text === "" ? "" : `?${text}`;
  };
  return {
    closeHref: (period: string) => `/closes/${period}${query(null)}`,
    summaryHref: (year: string | null) => `/${query(year)}`,
  };
};

// Resumen over the prototype's store.
export function PrototypeSummary({ params }: { params: KeysetParams }) {
  const { state, snapshot } = usePrototype();
  const reference = summaryHome(state);
  const unit = closeUnitOf(params, reference);
  const { closeHref } = linksIn(unit, reference);
  const closes = closesOf(state, unit);
  const years = yearsOfCloses(closes);
  // The year the table shows: ?year=, else the newest.
  const { year } = parseAssetsParams(params, {
    portfolioIds: [],
    tabs: TABS,
    salesYears: years.map((each) => each.year),
  });
  return (
    <SummaryPage
      closes={closes}
      years={years}
      year={years.find((each) => each.year === year)}
      valuation={holdingsValuation({
        holdings: holdingsView(state).active,
        truncated: false,
        snapshot,
        unit,
        referenceDollar: state.referenceDollar,
      })}
      unit={unit}
      referenceUnit={reference}
      params={params}
      closeHref={closeHref}
      yearHref={closeHref}
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
  const { closeHref, summaryHref } = linksIn(unit, reference);
  const years = yearsOfCloses(closesOf(state, unit));
  const backHref = summaryHref(
    period.slice(0, 4) === years[0]?.year ? null : period.slice(0, 4),
  );
  if (/^\d{4}$/.test(period)) {
    const year = years.find((each) => each.year === period);
    if (!year) notFound();
    return (
      <YearCloseDetail
        year={year}
        unit={unit}
        backHref={backHref}
        closeHref={closeHref}
      />
    );
  }
  const detail = /^\d{4}-\d{2}$/.test(period)
    ? monthDetail(state, unit, period)
    : null;
  if (!detail) notFound();
  return <MonthCloseDetail detail={detail} unit={unit} backHref={backHref} />;
}
