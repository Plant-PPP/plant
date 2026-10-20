import { unpinChart } from "@/app/(app)/(data)/assistant/actions";
import { seePriceAlert } from "@/app/(app)/(data)/settings/actions";
import type { PriceAlert } from "@/lib/alerts/alerts";
import { readAlerts } from "@/lib/alerts/read";
import type { PinnedChart } from "@/components/summary/pinned-charts";
import { CHAT_UNITS, type ChatUnit } from "@/lib/assistant/chat";
import { type Pin, readPins } from "@/lib/assistant/pins";
import { assistantData } from "@/lib/assistant/tools-data";
import { referenceUnit } from "@plant/core";
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
import { readReferenceDollar } from "@/lib/holdings/read";
import { SCOPE_HREFS } from "@/lib/holdings/scope-hrefs";
import type { HoldingsValuation } from "@/lib/holdings/valuation-view";
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
import { closesOf, monthDetail, yearsOfCloses } from "@/lib/summary/compute";
import {
  type ClosesRead,
  closesReadFields,
  readCloses,
  SUMMARY_VIEW_EVENT,
} from "@/lib/summary/read";
import { summaryValuation } from "@/lib/summary/valuation";
import type { KeysetParams } from "@/lib/supabase/keyset";
import { createClient } from "@/lib/supabase/server";

// Who is reading, and through which client.
async function viewContext(params: KeysetParams) {
  const claims = await getSessionClaims();
  const client = await createClient();
  const context: ReadContext = {
    userId: claims.sub,
    requestId: await currentRequestId(),
    page: "/",
    params,
  };
  return { client, context, today: buenosAiresDate(new Date()) };
}

// The user's closes in the unit ?unit= names, when closes have it, else in
// the reference dollar's.
async function closesView({
  client,
  context,
  today,
}: Awaited<ReturnType<typeof viewContext>>) {
  const referenceDollar = readReferenceDollar(client, context);
  const read = await readCloses(client, context, { today, referenceDollar });
  const reference = referenceUnit(await referenceDollar);
  const unit = closeUnit(
    parseAssetsParams(context.params, {
      portfolioIds: [],
      tabs: TABS,
      salesYears: [],
    }).unit,
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
  ...closesReadFields(read),
});

// The price alerts the quotes met that the user has not seen; none, logged
// and flagged, when they could not be read.
async function metAlerts({
  client,
  context,
}: Awaited<ReturnType<typeof viewContext>>): Promise<{
  alerts: PriceAlert[];
  readFailed: boolean;
}> {
  try {
    const alerts = (await readAlerts(client)).filter(
      (each) => each.metOn !== null && each.seenAt === null,
    );
    return { alerts, readFailed: false };
  } catch (error) {
    serverLog.error(
      SUMMARY_VIEW_EVENT,
      { ...contextFields(context), "plant.outcome": "alerts_failed" },
      error,
    );
    return { alerts: [], readFailed: true };
  }
}

// The user's pins; none, logged, when they could not be read.
async function pinsOf({
  client,
  context,
}: Awaited<ReturnType<typeof viewContext>>): Promise<Pin[]> {
  try {
    return await readPins(client);
  } catch (error) {
    serverLog.error(
      SUMMARY_VIEW_EVENT,
      { ...contextFields(context), "plant.outcome": "pins_failed" },
      error,
    );
    return [];
  }
}

// The charts the user pinned from the assistant, each drawn again from the
// data Resumen read, in its unit (the reference dollar's when the assistant
// has no such unit). One that fails is shown as not drawn, never the page.
async function pinnedCharts(
  { client, context, today }: Awaited<ReturnType<typeof viewContext>>,
  pins: Promise<Pin[]>,
  { read, unit, reference }: Awaited<ReturnType<typeof closesView>>,
): Promise<PinnedChart[]> {
  const pinned = await pins;
  if (pinned.length === 0) return [];
  const data = assistantData({
    client,
    context,
    unit: CHAT_UNITS.includes(unit as ChatUnit)
      ? (unit as ChatUnit)
      : reference,
    today,
    read: Promise.resolve(read),
  });
  return Promise.all(
    pinned.map(async (pin): Promise<PinnedChart> => {
      try {
        const drawn = await data.chart(pin.topic, pin.portfolioId ?? undefined);
        return "error" in drawn
          ? { id: pin.id, chart: null, asOf: today }
          : { id: pin.id, chart: drawn.chart, asOf: drawn.asOf };
      } catch (error) {
        serverLog.error(
          SUMMARY_VIEW_EVENT,
          { ...contextFields(context), "plant.outcome": "pin_failed" },
          error,
        );
        return { id: pin.id, chart: null, asOf: today };
      }
    }),
  );
}

// Resumen: the net worth today, how it is split, and its closes; with
// ?portfolio=, one portfolio's assets today.
export async function SummaryView({ params }: { params: KeysetParams }) {
  const at = await viewContext(params);
  const alerts = metAlerts(at);
  const pins = pinsOf(at);
  const view = await closesView(at);
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
  let rows: ClosesRead["holdings"]["active"];
  let valuation: HoldingsValuation;
  try {
    ({ rows, valuation } = summaryValuation(read, {
      unit,
      portfolioId: portfolio?.id ?? null,
    }));
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

  const met = await alerts;
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
      pinned={pinnedCharts(at, pins, view)}
      onUnpin={unpinChart}
      metAlerts={met.alerts}
      alertsReadFailed={met.readFailed}
      onAlertSeen={seePriceAlert}
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
  const view = await closesView(await viewContext(params));
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
