import {
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
import { DEBTS_VIEW_EVENT, readLiabilities } from "@/lib/debts/read";
import { isProductionDeployment } from "@/lib/deployment";
import { parseAssetsParams, TABS } from "@/lib/holdings/assets-filter";
import { assetsViewFailure } from "@/lib/holdings/assets-view";
import { readInstruments, readReferenceDollar } from "@/lib/holdings/read";
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
  const [debts, instruments, dollar] = await Promise.all([
    readLiabilities(client).catch((error: unknown) =>
      assetsViewFailure(context, "debts", error),
    ),
    readInstruments(client, context),
    readReferenceDollar(client, context),
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
  const valued = valueLiabilities(debts.active, quotes.snapshot, {
    denominator: unit,
    referenceDollar: dollar,
  });

  serverLog.info(DEBTS_VIEW_EVENT, {
    ...contextFields(context),
    "plant.outcome": valued.complete ? "ok" : "incomplete",
    "plant.liability.count": debts.active.length,
    "plant.liability.truncated": debts.activeTruncated,
    "plant.liability.missing_count": valued.items.filter(
      (item) => item.value === null,
    ).length,
    "plant.assets.unit": unit,
    "plant.quotes.dropped_count": quotes.invalidCount,
  });

  return (
    <div>
      <h1 className="sr-only">{navTitle("/debts")}</h1>
      <DebtsSetup
        debts={debts}
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
