import "server-only";
import { readQuotesOn, type ReferenceDollar } from "@plant/core";
import type { Database } from "@plant/shared";
import type { SupabaseClient } from "@supabase/supabase-js";

import { readLiabilities } from "@/lib/debts/read";
import { assetsViewFailure } from "@/lib/holdings/assets-view";
import { type HoldingsView, readHoldings } from "@/lib/holdings/read";
import { MANUAL, type StoredHolding } from "@/lib/ledger/ledger";
import { readLedger } from "@/lib/ledger/read";
import type { ReadContext } from "@/lib/portfolio-setup/read";
import { createQuoteReader } from "@/lib/quotes/quote-reader";
import {
  type ClosesState,
  closeDates,
  closesNeed,
} from "@/lib/summary/compute";

type Client = SupabaseClient<Database>;

export const SUMMARY_VIEW_EVENT = "summary.view";

// What Resumen and a close's page compute from, and what each read cut.
export type ClosesRead = {
  state: ClosesState;
  holdings: HoldingsView;
  ledgerTruncated: boolean;
  debtsTruncated: boolean;
};

// The user's ledger with every open holding (a holding that is not an
// instrument has no movements, so its amount today stands for every past
// day), their debts, and the stored quotes of every day the closes value at.
// No closed month is marked recalculated: nothing keeps a close's figures to
// compare a write against.
export async function readCloses(
  client: Client,
  context: ReadContext,
  {
    today,
    referenceDollar,
  }: { today: string; referenceDollar: ReferenceDollar },
): Promise<ClosesRead> {
  const [holdings, read, debts] = await Promise.all([
    readHoldings(client, context),
    readLedger(client, { today, referenceDollar }).catch((error: unknown) =>
      assetsViewFailure(context, "ledger", error),
    ),
    readLiabilities(client).catch((error: unknown) =>
      assetsViewFailure(context, "debts", error),
    ),
  ]);
  const others: StoredHolding[] = holdings.active
    .filter((row) => row.holding.asset_class !== "instrument")
    .map((row) => ({
      holding: row.holding,
      accountId: row.account.id,
      portfolioId: row.portfolio.id,
      closed: false,
      origin: MANUAL,
    }));
  const unquoted: ClosesState = {
    ...read.ledger,
    holdings: [...read.ledger.holdings, ...others],
    liabilities: debts.active,
    recalculated: new Map(),
  };
  const quotes = await readQuotesOn(
    createQuoteReader(client),
    closeDates(unquoted),
    closesNeed(unquoted),
  ).catch((error: unknown) => assetsViewFailure(context, "snapshot", error));
  return {
    state: { ...unquoted, quotes },
    holdings,
    ledgerTruncated: read.truncated,
    debtsTruncated: debts.activeTruncated,
  };
}
