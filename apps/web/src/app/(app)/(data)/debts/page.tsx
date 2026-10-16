import {
  liabilitiesOn,
  liabilityBalances,
  liabilityQuotesNeeded,
  readSnapshot,
  referenceUnit,
  valueLiabilities,
} from "@plant/core";
import { buenosAiresDate } from "@plant/shared";
import type { Metadata } from "next";

import { createDebt, deleteDebt, updateDebt } from "./actions";
import { DebtsSetup } from "@/components/debts/debts-setup";
import { PrototypeDebts } from "@/components/prototype/prototype-debts";
import { getSessionClaims } from "@/lib/auth/session-claims";
import {
  DEBTS_VIEW_EVENT,
  debtsViewOutcome,
  readLiabilities,
  readLiabilityEvents,
} from "@/lib/debts/read";
import { isProductionDeployment } from "@/lib/deployment";
import { parseAssetsParams, TABS } from "@/lib/holdings/assets-filter";
import { assetsViewFailure } from "@/lib/holdings/assets-view";
import { readInstruments, readReferenceDollar } from "@/lib/holdings/read";
import { pricedSnapshotOf } from "@/lib/ledger/ledger";
import { readLedger } from "@/lib/ledger/read";
import { serverLog } from "@/lib/log/server-log";
import { navTitle } from "@/lib/navigation";
import { contextFields } from "@/lib/portfolio-setup/read";
import { createQuoteReader } from "@/lib/quotes/quote-reader";
import { currentRequestId } from "@/lib/request-id-server";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: navTitle("/debts") };
export const dynamic = "force-dynamic";

// The user's debts valued at today's quotes in one unit (the reference dollar
// unless ?unit= names another). Outside production it shows made-up debts.
export default async function DebtsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
} = {}) {
  const params = (await searchParams) ?? {};
  if (!isProductionDeployment()) {
    return <PrototypeDebts params={params} />;
  }
  const claims = await getSessionClaims();
  const client = await createClient();
  const context = {
    userId: claims.sub,
    requestId: await currentRequestId(),
    page: "/debts" as const,
    params,
  };
  const today = buenosAiresDate(new Date());
  const [debts, events, instruments, dollar, { ledger }] = await Promise.all([
    readLiabilities(client).catch((error: unknown) =>
      assetsViewFailure(context, "debts", error),
    ),
    readLiabilityEvents(client).catch((error: unknown) =>
      assetsViewFailure(context, "debt_events", error),
    ),
    readInstruments(client, context),
    readReferenceDollar(client, context),
    // For the user's manual prices and rates, as every other page values.
    readLedger(client, { today, referenceDollar: "mep" }).catch(
      (error: unknown) => assetsViewFailure(context, "ledger", error),
    ),
  ]);
  const quotes = await readSnapshot(
    createQuoteReader(client),
    today,
    liabilityQuotesNeeded(debts.active),
  ).catch((error: unknown) => assetsViewFailure(context, "snapshot", error));
  const reference = referenceUnit(dollar);
  const unit =
    parseAssetsParams(params, { portfolioIds: [], tabs: TABS, salesYears: [] })
      .unit ?? reference;
  const figures = liabilityBalances(debts.active, events.byLiability, today);
  const owed = liabilitiesOn(debts.active, figures);
  const overflowCount = [...figures.values()].filter(
    (figure) => figure.overflow,
  ).length;
  const valued = valueLiabilities(
    owed,
    pricedSnapshotOf(ledger, quotes.snapshot).snapshot,
    {
      denominator: unit,
      referenceDollar: dollar,
    },
  );

  serverLog.info(DEBTS_VIEW_EVENT, {
    ...contextFields(context),
    ...debtsViewOutcome(valued, events.cut, overflowCount),
    "plant.liability.count": debts.active.length,
    "plant.liability.truncated": debts.activeTruncated,
    "plant.assets.unit": unit,
    "plant.quotes.dropped_count": quotes.invalidCount,
  });

  return (
    <div>
      <h1 className="sr-only">{navTitle("/debts")}</h1>
      <DebtsSetup
        debts={debts}
        owed={owed}
        complete={!events.cut && overflowCount === 0}
        valued={valued}
        unit={unit}
        referenceUnit={reference}
        params={params}
        instruments={instruments.rows}
        actions={{ create: createDebt, update: updateDebt, delete: deleteDebt }}
      />
    </div>
  );
}
