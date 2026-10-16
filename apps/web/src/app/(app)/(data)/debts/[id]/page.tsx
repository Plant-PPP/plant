import {
  liabilitiesOn,
  liabilityBalance,
  liabilityQuotesNeeded,
  quotesNeeded,
  readSnapshot,
  referenceUnit,
  valueLiabilities,
} from "@plant/core";
import { buenosAiresDate } from "@plant/shared";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";

import {
  deleteDebt,
  deleteDebtEvent,
  recordDebtEvent,
  setDebtCollateral,
  updateDebt,
  updateDebtEvent,
} from "../actions";
import { DebtHistory } from "@/components/debts/debt-history";
import { PrototypeDebt } from "@/components/prototype/prototype-debt";
import { getSessionClaims } from "@/lib/auth/session-claims";
import { debtPageInputs } from "@/lib/debts/page-inputs";
import {
  DEBTS_VIEW_EVENT,
  debtsViewOutcome,
  readCollateral,
  readLiability,
  readLiabilityEvents,
} from "@/lib/debts/read";
import { isProductionDeployment } from "@/lib/deployment";
import { parseAssetsParams, TABS } from "@/lib/holdings/assets-filter";
import { assetsViewFailure } from "@/lib/holdings/assets-view";
import { readHoldings, readReferenceDollar } from "@/lib/holdings/read";
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

// One debt: its figures today, its events and what is pledged for it, in one
// unit (the reference dollar unless ?unit= names another). An id that is not
// one of the user's debts has no page. Outside production it shows made-up
// data.
export default async function DebtPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const query = await searchParams;
  if (!isProductionDeployment()) {
    return <PrototypeDebt id={id} params={query} />;
  }
  const claims = await getSessionClaims();
  const client = await createClient();
  const context = {
    userId: claims.sub,
    requestId: await currentRequestId(),
    page: "/debts" as const,
    params: query,
  };
  // An id that is not one of the user's debts, malformed or another
  // user's, answers alike.
  const missing = (): never => {
    serverLog.warn(DEBTS_VIEW_EVENT, {
      ...contextFields(context),
      "plant.outcome": "not_found",
      // Only a well-formed id: anything else is text the user typed.
      "plant.liability.id": z.uuid().safeParse(id).success ? id : undefined,
    });
    notFound();
  };
  if (!z.uuid().safeParse(id).success) missing();
  const today = buenosAiresDate(new Date());
  const [debt, events, collateral, held, dollar, { ledger: read }] =
    await Promise.all([
      readLiability(client, id).catch((error: unknown) =>
        assetsViewFailure(context, "debts", error),
      ),
      readLiabilityEvents(client, id).catch((error: unknown) =>
        assetsViewFailure(context, "debt_events", error),
      ),
      readCollateral(client, id).catch((error: unknown) =>
        assetsViewFailure(context, "debt_collateral", error),
      ),
      readHoldings(client, context),
      readReferenceDollar(client, context),
      readLedger(client, { today, referenceDollar: "mep" }).catch(
        (error: unknown) => assetsViewFailure(context, "ledger", error),
      ),
    ]);
  if (!debt) return missing();
  const ledger = { ...read, referenceDollar: dollar };
  const forHoldings = quotesNeeded(held.active.map((row) => row.holding));
  const forDebt = liabilityQuotesNeeded([debt]);
  const quotes = await readSnapshot(createQuoteReader(client), today, {
    fxKinds: [...new Set([...forHoldings.fxKinds, ...forDebt.fxKinds])],
    symbols: [...new Set([...forHoldings.symbols, ...forDebt.symbols])],
  }).catch((error: unknown) => assetsViewFailure(context, "snapshot", error));
  const snapshot = pricedSnapshotOf(ledger, quotes.snapshot).snapshot;
  const reference = referenceUnit(dollar);
  const unit =
    parseAssetsParams(query, { portfolioIds: [], tabs: TABS, salesYears: [] })
      .unit ?? reference;
  const debtEvents = events.byLiability.get(id) ?? [];
  const figure = liabilityBalance(debt, debtEvents, today);
  const valued = valueLiabilities(
    liabilitiesOn([debt], new Map([[id, figure]])),
    snapshot,
    { denominator: unit, referenceDollar: dollar },
  );

  serverLog.info(DEBTS_VIEW_EVENT, {
    ...contextFields(context),
    ...debtsViewOutcome(valued, events.cut, figure.overflow ? 1 : 0),
    "plant.liability.id": id,
    "plant.liability.event_count": debtEvents.length,
    "plant.liability.collateral_count": collateral.length,
    "plant.assets.unit": unit,
    "plant.quotes.dropped_count": quotes.invalidCount,
  });

  return (
    <DebtHistory
      debt={debt}
      events={debtEvents}
      collateral={collateral}
      complete={!events.cut}
      today={today}
      snapshot={snapshot}
      unit={unit}
      referenceUnit={reference}
      referenceDollar={dollar}
      params={query}
      instruments={ledger.instruments}
      {...debtPageInputs(
        held.active,
        ledger.instruments,
        debt,
        snapshot,
        unit,
        dollar,
      )}
      actions={{
        events: {
          record: recordDebtEvent,
          update: updateDebtEvent,
          delete: deleteDebtEvent,
        },
        debts: { update: updateDebt, delete: deleteDebt },
        collateral: setDebtCollateral,
      }}
    />
  );
}
