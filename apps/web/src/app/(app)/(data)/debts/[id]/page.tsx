import {
  liabilitiesOn,
  liabilityBalance,
  liabilityQuotesNeeded,
  quotesNeeded,
  readSnapshot,
  referenceUnit,
  valueLiabilities,
} from "@plant/core";
import { buenosAiresDate, shownTicker } from "@plant/shared";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";

import {
  deleteDebt,
  deleteDebtEvent,
  recordDebtEvent,
  setDebtCollateral,
  setDebtDisbursement,
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
  readDisbursement,
  readLiability,
  readLiabilityEvents,
} from "@/lib/debts/read";
import { isProductionDeployment } from "@/lib/deployment";
import { parseAssetsParams, TABS } from "@/lib/holdings/assets-filter";
import { formatQuantity } from "@/lib/format/amount";
import { formatDate } from "@/lib/format/date";
import { assetsViewFailure } from "@/lib/holdings/assets-view";
import {
  readHoldings,
  readInstruments,
  readReferenceDollar,
} from "@/lib/holdings/read";
import { pricedSnapshotOf } from "@/lib/ledger/ledger";
import { readManualQuotes } from "@/lib/ledger/read";
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
  const debtRead = readLiability(client, id).catch((error: unknown) =>
    assetsViewFailure(context, "debts", error),
  );
  const heldRead = readHoldings(client, context);
  const [debt, events, collateral, held, dollar, instruments, manual, quotes] =
    await Promise.all([
      debtRead,
      readLiabilityEvents(client, id).catch((error: unknown) =>
        assetsViewFailure(context, "debt_events", error),
      ),
      readCollateral(client, id).catch((error: unknown) =>
        assetsViewFailure(context, "debt_collateral", error),
      ),
      heldRead,
      readReferenceDollar(client, context),
      readInstruments(client, context),
      readManualQuotes(client).catch((error: unknown) =>
        assetsViewFailure(context, "ledger", error),
      ),
      Promise.all([debtRead, heldRead]).then(([found, rows]) => {
        const forHoldings = quotesNeeded(rows.active.map((row) => row.holding));
        const forDebt = liabilityQuotesNeeded(found ? [found] : []);
        return readSnapshot(createQuoteReader(client), today, {
          fxKinds: [...new Set([...forHoldings.fxKinds, ...forDebt.fxKinds])],
          symbols: [...new Set([...forHoldings.symbols, ...forDebt.symbols])],
        }).catch((error: unknown) =>
          assetsViewFailure(context, "snapshot", error),
        );
      }),
    ]);
  if (!debt) return missing();
  const disbursement = await readDisbursement(
    client,
    id,
    debt.instrument_symbol ?? null,
  ).catch((error: unknown) =>
    assetsViewFailure(context, "debt_disbursement", error),
  );
  const snapshot = pricedSnapshotOf(manual, quotes.snapshot).snapshot;
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
      instruments={instruments.rows}
      {...debtPageInputs(
        held.active,
        instruments.rows,
        debt,
        snapshot,
        unit,
        dollar,
      )}
      disbursement={{
        current: disbursement.current,
        options: disbursement.options.map((option) => ({
          operationId: option.operationId,
          label: `${formatDate(option.date)} · ${formatQuantity(option.quantity)} ${shownTicker(debt.instrument_symbol ?? "")}`,
          place: option.institution,
        })),
      }}
      actions={{
        events: {
          record: recordDebtEvent,
          update: updateDebtEvent,
          delete: deleteDebtEvent,
        },
        debts: { update: updateDebt, delete: deleteDebt },
        collateral: setDebtCollateral,
        disbursement: setDebtDisbursement,
      }}
    />
  );
}
