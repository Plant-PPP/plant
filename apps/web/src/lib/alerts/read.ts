import "server-only";
import type { Database } from "@plant/shared";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { classifyPostgrestResult } from "@/lib/supabase/postgrest-write";

import { MAX_ALERTS, type NewAlert, type PriceAlert } from "./alerts";

type Client = SupabaseClient<Database>;

export class AlertsError extends Error {
  constructor(readonly code: string) {
    super(`price alerts failed: ${code}`);
  }
}

const rowSchema = z.object({
  id: z.string(),
  subject_kind: z.enum(["instrument", "dollar"]),
  subject: z.string(),
  direction: z.enum(["above", "below"]),
  threshold: z.string(),
  currency: z.enum(["ARS", "USD"]),
  met_on: z.string().nullable(),
  met_price: z.string().nullable(),
  seen_at: z.string().nullable(),
});

// Amounts are selected as text, so they stay exact decimal strings.
const COLUMNS =
  "id, subject_kind, subject, direction, threshold:threshold::text, currency, " +
  "met_on, met_price:met_price::text, seen_at";

// The user's alerts, newest first, under RLS.
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
  if (failure || !result.data)
    throw new AlertsError(failure?.code ?? "no_data");
  return (result.data as unknown[]).map((data) => {
    const row = rowSchema.parse(data);
    return {
      id: row.id,
      subjectKind: row.subject_kind,
      subject: row.subject,
      direction: row.direction,
      threshold: row.threshold,
      currency: row.currency,
      metOn: row.met_on,
      metPrice: row.met_price,
      seenAt: row.seen_at,
    };
  });
}

// Sets an alert for the session's user; false past MAX_ALERTS.
export async function createAlert(
  client: Client,
  alert: NewAlert,
): Promise<boolean> {
  if ((await readAlerts(client)).length >= MAX_ALERTS) return false;
  const result = await client.from("price_alerts").insert({
    subject_kind: alert.subjectKind,
    subject: alert.subject,
    direction: alert.direction,
    threshold: alert.threshold as unknown as number,
    currency: alert.currency,
  });
  if (classifyPostgrestResult(result, 201)) throw new AlertsError("insert");
  return true;
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
