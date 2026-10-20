import "server-only";
import { cashTakenFrom, readQuotesOn, type ReferenceDollar } from "@plant/core";
import type { Database } from "@plant/shared";
import type { SupabaseClient } from "@supabase/supabase-js";

import { readCashMovements } from "@/lib/cash/read";
import { readLiabilities, readLiabilityEvents } from "@/lib/debts/read";
import { assetsViewFailure } from "@/lib/holdings/assets-view";
import {
  type HoldingsView,
  readUnlistedCash,
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
  skippedCashPayments,
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
  cashTruncated: boolean;
  archivedCashCount: number;
};

// What a closes read cut or left out, for the lines its pages log: flags
// and counts only.
export const closesReadFields = (read: ClosesRead) => ({
  "plant.ledger.truncated": read.ledgerTruncated,
  "plant.liability.truncated": read.debtsTruncated,
  "plant.liability.events_truncated": read.debtEventsTruncated,
  "plant.cash.truncated": read.cashTruncated,
  "plant.assets.truncated": read.holdings.activeTruncated,
  "plant.closes.archived_cash_count": read.archivedCashCount,
  "plant.closes.cash_take_skipped_count": skippedCashPayments(read.state),
});

// The user's ledger with every open holding and the archived cash holdings a
// debt payment may have emptied or that have a history (a holding that is not
// an instrument has no movements: its amount today, plus what payments took
// from cash and less what a cash history added after, stands for every past
// day), their debts, the cash histories, and the stored quotes of every day
// the closes value at.
// No closed month is marked recalculated: nothing keeps a close's figures to
// compare a write against.
export async function readCloses(
  client: Client,
  context: ReadContext,
  {
    today,
    referenceDollar,
  }: {
    today: string;
    // A promise lets the caller start this read before the profile's.
    referenceDollar: ReferenceDollar | PromiseLike<ReferenceDollar>;
  },
): Promise<ClosesRead> {
  const [reference, holdings, read, debts, events, cash] = await Promise.all([
    referenceDollar,
    readHoldings(client, context, { archived: false }),
    // The ledger takes the reference dollar only to carry it.
    readLedger(client, { today, referenceDollar: "mep" }).catch(
      (error: unknown) => assetsViewFailure(context, "ledger", error),
    ),
    readLiabilities(client).catch((error: unknown) =>
      assetsViewFailure(context, "debts", error),
    ),
    readLiabilityEvents(client).catch((error: unknown) =>
      assetsViewFailure(context, "debt_events", error),
    ),
    readCashMovements(client).catch((error: unknown) =>
      assetsViewFailure(context, "cash_movements", error),
    ),
  ]);
  const others: StoredHolding[] = holdings.active
    .filter((row) => row.holding.asset_class !== "instrument")
    .map((row) => storedOf(row, false));
  const open = new Set(others.map((each) => each.holding.id));
  // Holdings the debts' payments took cash from that are not open: one a
  // payment emptied was archived.
  const taken = new Set([
    ...debts.active.flatMap((debt) =>
      (events.byLiability.get(debt.id) ?? []).flatMap((event) => {
        const id = cashTakenFrom(event, today);
        return id === null || open.has(id) ? [] : [id];
      }),
    ),
    ...[...cash.byHolding.keys()].filter((id) => !open.has(id)),
  ]);
  const emptied =
    taken.size === 0
      ? []
      : (await readUnlistedCash(client, context, [...taken])).map((row) =>
          storedOf(row, true),
        );
  const unquoted: ClosesState = {
    ...read.ledger,
    referenceDollar: reference,
    holdings: [...read.ledger.holdings, ...others, ...emptied],
    liabilities: debts.active,
    liabilityEvents: events.byLiability,
    cashMovements: cash.byHolding,
    recalculated: new Map(),
    partial:
      read.truncated ||
      events.cut ||
      cash.cut ||
      debts.activeTruncated ||
      holdings.activeTruncated,
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
    cashTruncated: cash.cut,
    archivedCashCount: emptied.length,
  };
}
