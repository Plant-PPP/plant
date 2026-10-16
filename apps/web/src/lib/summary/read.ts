import "server-only";
import { readQuotesOn, type ReferenceDollar } from "@plant/core";
import type { Database } from "@plant/shared";
import type { SupabaseClient } from "@supabase/supabase-js";

import { readLiabilities, readLiabilityEvents } from "@/lib/debts/read";
import { assetsViewFailure } from "@/lib/holdings/assets-view";
import {
  type HoldingsView,
  readArchivedCash,
  readHoldings,
} from "@/lib/holdings/read";
import { type StoredHolding, storedOf } from "@/lib/ledger/ledger";
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
  debtEventsTruncated: boolean;
  archivedCashCount: number;
};

// The user's ledger with every open holding and the archived cash holdings a
// debt payment may have emptied (a holding that is not an instrument has no
// movements: its amount today, plus what payments took from cash, stands for
// every past day), their debts, and the stored quotes of every day the closes
// value at.
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
  const [holdings, read, debts, events] = await Promise.all([
    readHoldings(client, context, { archived: false }),
    readLedger(client, { today, referenceDollar }).catch((error: unknown) =>
      assetsViewFailure(context, "ledger", error),
    ),
    readLiabilities(client).catch((error: unknown) =>
      assetsViewFailure(context, "debts", error),
    ),
    readLiabilityEvents(client).catch((error: unknown) =>
      assetsViewFailure(context, "debt_events", error),
    ),
  ]);
  const others: StoredHolding[] = holdings.active
    .filter((row) => row.holding.asset_class !== "instrument")
    .map((row) => storedOf(row, false));
  const open = new Set(others.map((each) => each.holding.id));
  // The holdings payments of the debts read took cash from that are not
  // open: an emptied one was archived.
  const taken = new Set(
    debts.active.flatMap((debt) =>
      (events.byLiability.get(debt.id) ?? []).flatMap((event) =>
        event.takes_cash &&
        event.cash_holding_id !== null &&
        !open.has(event.cash_holding_id)
          ? [event.cash_holding_id]
          : [],
      ),
    ),
  );
  const emptied =
    taken.size === 0
      ? []
      : (await readArchivedCash(client, context, [...taken])).map((row) =>
          storedOf(row, true),
        );
  const unquoted: ClosesState = {
    ...read.ledger,
    holdings: [...read.ledger.holdings, ...others, ...emptied],
    liabilities: debts.active,
    liabilityEvents: events.byLiability,
    recalculated: new Map(),
    partial: events.cut || debts.activeTruncated || holdings.activeTruncated,
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
    debtEventsTruncated: events.cut,
    archivedCashCount: emptied.length,
  };
}
