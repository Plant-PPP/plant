import { referenceUnit, snapshotOn } from "@plant/core";
import { buenosAiresDate } from "@plant/shared";
import { notFound } from "next/navigation";

import {
  MonthCloseDetail,
  YearCloseDetail,
} from "@/components/summary/close-detail";
import { SummaryPage } from "@/components/summary/summary-page";
import { getSessionClaims } from "@/lib/auth/session-claims";
import { parseAssetsParams, TABS } from "@/lib/holdings/assets-filter";
import { assetsViewFailure } from "@/lib/holdings/assets-view";
import { currencyOf } from "@/lib/holdings/holding-name";
import { readReferenceDollar } from "@/lib/holdings/read";
import { SCOPE_HREFS } from "@/lib/holdings/scope-hrefs";
import {
  type HoldingsValuation,
  holdingsValuation,
} from "@/lib/holdings/valuation-view";
import { pricedSnapshotOf } from "@/lib/ledger/ledger";
import { serverLog } from "@/lib/log/server-log";
import { contextFields, type ReadContext } from "@/lib/portfolio-setup/read";
import { currentRequestId } from "@/lib/request-id-server";
import {
  backYear,
  closesQuery,
  closeUnit,
  type MonthClose,
  type MonthDetail,
  type YearClose,
} from "@/lib/summary/closes";
import {
  closesNeed,
  closesOf,
  monthDetail,
  yearsOfCloses,
} from "@/lib/summary/compute";
import { readCloses, SUMMARY_VIEW_EVENT } from "@/lib/summary/read";
import type { KeysetParams } from "@/lib/supabase/keyset";
import { createClient } from "@/lib/supabase/server";

// The user's closes in the unit ?unit= names, when closes have it, else in
// the reference dollar's.
async function closesView(params: KeysetParams) {
  const claims = await getSessionClaims();
  const client = await createClient();
  const context: ReadContext = {
    userId: claims.sub,
    requestId: await currentRequestId(),
    page: "/",
    params,
  };
  const today = buenosAiresDate(new Date());
  const referenceDollar = await readReferenceDollar(client, context);
  const read = await readCloses(client, context, { today, referenceDollar });
  const reference = referenceUnit(referenceDollar);
  const unit = closeUnit(
    parseAssetsParams(params, { portfolioIds: [], tabs: TABS, salesYears: [] })
      .unit,
    reference,
  );
  let closes: MonthClose[];
  let years: YearClose[];
  try {
    closes = closesOf(read.state, unit);
    years = yearsOfCloses(closes);
  } catch (error) {
    assetsViewFailure(context, "valuation", error);
  }
  return { context, read, reference, unit, closes, years };
}

// What every line the closes log carries.
const closesFields = ({
  context,
  read,
  unit,
  closes,
}: Awaited<ReturnType<typeof closesView>>) => ({
  ...contextFields(context),
  "plant.assets.unit": unit,
  "plant.closes.month_count": closes.length,
  "plant.ledger.truncated": read.ledgerTruncated,
  "plant.liability.truncated": read.debtsTruncated,
  "plant.assets.truncated": read.holdings.activeTruncated,
});

// Resumen: the net worth today, how it is split, and its closes; with
// ?portfolio=, one portfolio's assets today.
export async function SummaryView({ params }: { params: KeysetParams }) {
  const view = await closesView(params);
  const { context, read, reference, unit, closes, years } = view;
  const { state } = read;
  const {
    year,
    filter: { portfolioId },
  } = parseAssetsParams(params, {
    portfolioIds: state.portfolios.map((each) => each.id),
    tabs: TABS,
    salesYears: years.map((each) => each.year),
  });
  const portfolio =
    state.portfolios.find((each) => each.id === portfolioId) ?? null;
  const rows = read.holdings.active.filter(
    (row) => portfolio === null || row.portfolio.id === portfolio.id,
  );
  let valuation: HoldingsValuation;
  try {
    valuation = holdingsValuation({
      holdings: rows,
      truncated: read.holdings.activeTruncated,
      snapshot: pricedSnapshotOf(
        state,
        snapshotOn(state.quotes, state.today, closesNeed(state)).snapshot,
      ).snapshot,
      unit,
      referenceDollar: state.referenceDollar,
      currencyOf: (holding) =>
        holding.asset_class === "instrument"
          ? currencyOf(state.instruments, holding.instrument_symbol)
          : holding.currency,
    });
  } catch (error) {
    assetsViewFailure(context, "valuation", error);
  }

  serverLog.info(SUMMARY_VIEW_EVENT, {
    ...closesFields(view),
    "plant.outcome": valuation.kinds.total.complete ? "ok" : "incomplete",
    "plant.assets.holding_count": rows.length,
    "plant.assets.missing_count": valuation.kinds.total.missing,
    "plant.summary.portfolio": portfolio !== null,
  });

  return (
    <SummaryPage
      closes={closes}
      years={years}
      year={years.find((each) => each.year === year)}
      rows={rows}
      valuation={valuation}
      portfolios={state.portfolios}
      portfolio={portfolio}
      unit={unit}
      referenceUnit={reference}
      params={params}
      hrefs={SCOPE_HREFS}
      closesQuery={closesQuery(unit, reference)}
    />
  );
}

// A month's (2026-09) or a year's (2026) close; a period with no close has no
// page.
export async function CloseView({
  period,
  params,
}: {
  period: string;
  params: KeysetParams;
}) {
  const view = await closesView(params);
  const { context, read, reference, unit, years } = view;
  const backHref = `/${closesQuery(unit, reference, backYear(period, years))}`;
  const year = /^\d{4}$/.test(period)
    ? years.find((each) => each.year === period)
    : undefined;
  let detail: MonthDetail | null = null;
  if (!year && /^\d{4}-\d{2}$/.test(period)) {
    try {
      detail = monthDetail(read.state, unit, period);
    } catch (error) {
      assetsViewFailure(context, "valuation", error);
    }
  }
  if (!year && !detail) notFound();

  serverLog.info(SUMMARY_VIEW_EVENT, {
    ...closesFields(view),
    "plant.outcome": (year ?? detail!.close).complete ? "ok" : "incomplete",
    "plant.closes.period": year ? "year" : "month",
  });

  return year ? (
    <YearCloseDetail
      year={year}
      unit={unit}
      backHref={backHref}
      closesQuery={closesQuery(unit, reference)}
    />
  ) : (
    <MonthCloseDetail detail={detail!} unit={unit} backHref={backHref} />
  );
}
