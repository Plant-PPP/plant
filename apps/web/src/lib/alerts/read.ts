import "server-only";
import { compareDecimals, type Database } from "@plant/shared";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { Ledger } from "@/lib/ledger/ledger";
import { classifyPostgrestResult } from "@/lib/supabase/postgrest-write";

import { MAX_ALERTS, type NewAlert, type PriceAlert } from "./alerts";
import { gainFigure } from "./gain";

type Client = SupabaseClient<Database>;

export class AlertsError extends Error {
  constructor(readonly code: string) {
    super(`price alerts failed: ${code}`);
  }
}

// Why an alert was not set: the user has the most, or the instrument is not
// in the catalog.
export type CreateResult = "ok" | "full" | "unknown_instrument";

const rowSchema = z.object({
  id: z.string(),
  subject_kind: z.enum(["instrument", "dollar"]),
  subject: z.string(),
  direction: z.enum(["above", "below"]),
  threshold: z.string().nullable(),
  currency: z.enum(["ARS", "USD"]),
  gain_percent: z.string().nullable(),
  cost_price: z.string().nullable(),
  met_on: z.string().nullable(),
  met_price: z.string().nullable(),
  seen_at: z.string().nullable(),
});

// Amounts are selected as text, so they stay exact decimal strings.
const COLUMNS =
  "id, subject_kind, subject, direction, threshold:threshold::text, currency, " +
  "gain_percent:gain_percent::text, cost_price:cost_price::text, " +
  "met_on, met_price:met_price::text, seen_at";

const alertOf = (data: unknown): PriceAlert => {
  const row = rowSchema.parse(data);
  return {
    id: row.id,
    subjectKind: row.subject_kind,
    subject: row.subject,
    direction: row.direction,
    threshold: row.threshold,
    currency: row.currency,
    gainPercent: row.gain_percent,
    costPrice: row.cost_price,
    metOn: row.met_on,
    metPrice: row.met_price,
    seenAt: row.seen_at,
  };
};

// The user's alerts, newest first, under RLS. The database keeps at most
// MAX_ALERTS of them.
export async function readAlerts(client: Client): Promise<PriceAlert[]> {
  const result = await client
    .from("price_alerts")
    .select(COLUMNS)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(MAX_ALERTS);
  const failure = classifyPostgrestResult(
    result as Parameters<typeof classifyPostgrestResult>[0],
    200,
  );
  if (failure || !result.data) {
    throw new AlertsError(failure?.code ?? "no_data");
  }
  return (result.data as unknown[]).map(alertOf);
}

// The currency an instrument is quoted in, from the catalog.
async function currencyOf(client: Client, symbol: string) {
  const result = await client
    .from("instruments")
    .select("currency")
    .eq("symbol", symbol)
    .maybeSingle();
  if (classifyPostgrestResult(result, 200)) {
    throw new AlertsError("instrument");
  }
  return result.data?.currency ?? null;
}

// Sets an alert for the session's user. A gain alert takes its instrument's
// currency and waits for its figure, which syncGainAlerts works out.
export async function createAlert(
  client: Client,
  alert: NewAlert,
): Promise<CreateResult> {
  let row: Database["public"]["Tables"]["price_alerts"]["Insert"];
  if (alert.subjectKind === "gain") {
    const currency = await currencyOf(client, alert.subject);
    if (currency === null) return "unknown_instrument";
    row = {
      subject_kind: "instrument",
      subject: alert.subject,
      direction: alert.direction,
      currency,
      gain_percent: alert.percent as unknown as number,
    };
  } else {
    row = {
      subject_kind: alert.subjectKind,
      subject: alert.subject,
      direction: alert.direction,
      threshold: alert.threshold as unknown as number,
      currency: alert.currency,
    };
  }
  const result = await client.from("price_alerts").insert(row);
  if (result.error?.hint === "price_alerts_full") return "full";
  if (classifyPostgrestResult(result, 201)) throw new AlertsError("insert");
  return "ok";
}

// Deletes one of the session's user's alerts; one already gone counts as
// deleted.
export async function deleteAlert(client: Client, id: string): Promise<void> {
  const result = await client.from("price_alerts").delete().eq("id", id);
  if (classifyPostgrestResult(result, 204)) throw new AlertsError("delete");
}

// Marks one of the session's user's met alerts seen.
export async function markAlertSeen(client: Client, id: string): Promise<void> {
  const result = await client
    .from("price_alerts")
    .update({ seen_at: new Date().toISOString() })
    .eq("id", id)
    .not("met_on", "is", null);
  if (classifyPostgrestResult(result, 204)) throw new AlertsError("seen");
}

const same = (a: string | null, b: string | null) =>
  a === null || b === null ? a === b : compareDecimals(a, b) === 0;

// Works the figure of each of the session's user's waiting gain alerts out
// again from their movements, and stores the ones that moved: how many. The
// ledger is read only when there is one, first to learn the days of the
// alerted instruments' movements and then with those days' dollar rates, so
// a lot bought in another currency has its cost.
export async function syncGainAlerts(
  client: Client,
  load: (
    dates: readonly string[],
  ) => Promise<{ ledger: Ledger; truncated: boolean }>,
): Promise<number> {
  const result = await client
    .from("price_alerts")
    .select(COLUMNS)
    .not("gain_percent", "is", null)
    .is("met_on", null)
    .limit(MAX_ALERTS);
  const failure = classifyPostgrestResult(
    result as Parameters<typeof classifyPostgrestResult>[0],
    200,
  );
  if (failure || !result.data) {
    throw new AlertsError(failure?.code ?? "no_data");
  }
  const alerts = (result.data as unknown[]).map(alertOf);
  if (alerts.length === 0) return 0;
  const { ledger: base, truncated: cut } = await load([]);
  // A ledger cut short would give a cost that is not the user's: the stored
  // figures stay until a full read.
  if (cut) return 0;
  const symbols = new Set(alerts.map((each) => each.subject));
  const alerted = new Set(
    base.holdings
      .filter((each) => symbols.has(each.holding.instrument_symbol ?? ""))
      .map((each) => each.holding.id),
  );
  const dates = [...base.movements]
    .filter(([holdingId]) => alerted.has(holdingId))
    .flatMap(([, movements]) => movements.map((each) => each.date));
  const read = dates.length > 0 ? await load(dates) : null;
  if (read?.truncated) return 0;
  const ledger = read?.ledger ?? base;
  let moved = 0;
  for (const alert of alerts) {
    const figure = gainFigure(ledger, {
      ...alert,
      gainPercent: alert.gainPercent!,
    });
    const threshold = figure?.threshold ?? null;
    const costPrice = figure?.costPrice ?? null;
    if (same(threshold, alert.threshold) && same(costPrice, alert.costPrice)) {
      continue;
    }
    const update = await client
      .from("price_alerts")
      .update({
        threshold: threshold as unknown as number,
        cost_price: costPrice as unknown as number,
      })
      .eq("id", alert.id)
      .is("met_on", null);
    // One alert the table refuses (a figure it cannot hold) leaves the others
    // to be worked out.
    if (!classifyPostgrestResult(update, 204)) moved += 1;
  }
  return moved;
}
