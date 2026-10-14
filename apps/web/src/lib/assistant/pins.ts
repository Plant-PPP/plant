import "server-only";
import type { Database } from "@plant/shared";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { classifyPostgrestResult } from "@/lib/supabase/postgrest-write";

import { CHART_TOPICS, type ChartPart, type PinResult } from "./chat";

type Client = SupabaseClient<Database>;

// The most charts Resumen shows pinned.
export const MAX_PINS = 12;

export type Pin = {
  id: string;
  topic: (typeof CHART_TOPICS)[number];
  portfolioId: string | null;
};

export const pinSourceSchema = z
  .object({
    topic: z.enum(CHART_TOPICS),
    portfolioId: z.uuid().nullable(),
  })
  .strict();

export class PinsError extends Error {
  constructor(readonly code: string) {
    super(`pins failed: ${code}`);
  }
}

const rowSchema = z.object({
  id: z.string(),
  topic: z.enum(CHART_TOPICS),
  portfolio_id: z.string().nullable(),
});

// The user's pinned charts, oldest first, under RLS.
export async function readPins(client: Client): Promise<Pin[]> {
  const result = await client
    .from("pinned_charts")
    .select("id, topic, portfolio_id")
    .order("created_at")
    .order("id")
    .limit(MAX_PINS);
  const failure = classifyPostgrestResult(result, 200);
  if (failure || !result.data) throw new PinsError(failure?.code ?? "no_data");
  return (result.data as unknown[]).map((data) => {
    const row = rowSchema.parse(data);
    return { id: row.id, topic: row.topic, portfolioId: row.portfolio_id };
  });
}

// Pins a chart for the session's user: once, and at most MAX_PINS of them.
export async function pinChart(
  client: Client,
  source: NonNullable<ChartPart["source"]>,
): Promise<PinResult> {
  if ((await readPins(client)).length >= MAX_PINS) return "full";
  const result = await client.from("pinned_charts").insert({
    topic: source.topic,
    portfolio_id: source.portfolioId,
  });
  if (result.error?.code === "23505") return "already";
  return classifyPostgrestResult(result, 201) ? "failed" : "pinned";
}

// Unpins one of the session's user's charts; false when it is not theirs.
export async function unpinChart(client: Client, id: string): Promise<boolean> {
  const result = await client
    .from("pinned_charts")
    .delete()
    .eq("id", id)
    .select("id");
  if (classifyPostgrestResult(result, 200)) throw new PinsError("delete");
  return (result.data ?? []).length === 1;
}
