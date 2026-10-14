import "server-only";
import { QUOTE_CARRY_DAYS } from "@plant/core";
import { addDays, type Database, positiveDecimalSchema } from "@plant/shared";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { type AssetKey, assetKeyOf } from "@/lib/holdings/assets-rows";
import { classifyPostgrestResult } from "@/lib/supabase/postgrest-write";

import type { OfficialBuy } from "./report";

type Client = SupabaseClient<Database>;

export const TAXES_VIEW_EVENT = "taxes.view";

export class TaxesReadError extends Error {
  constructor(readonly code: string) {
    super(`taxes read failed: ${code}`);
  }
}

// One row per asset the user can own, so a cap far above any portfolio.
const EXCLUSIONS_LIMIT = 1000;

const fail = (result: unknown): string | null =>
  classifyPostgrestResult(
    result as Parameters<typeof classifyPostgrestResult>[0],
    200,
  )?.code ?? null;

const officialSchema = z.object({
  rate_date: z.iso.date(),
  buy: positiveDecimalSchema,
});

// The official dollar's buying rate on `date`, or the latest one up to
// QUOTE_CARRY_DAYS before it, as every other quote is carried; null when
// none was stored.
export async function readOfficialBuy(
  client: Client,
  date: string,
): Promise<OfficialBuy | null> {
  const result = await client
    .from("fx_rates")
    .select("rate_date, buy:buy::text")
    .eq("kind", "official")
    .not("buy", "is", null)
    .gte("rate_date", addDays(date, -QUOTE_CARRY_DAYS))
    .lte("rate_date", date)
    .order("rate_date", { ascending: false })
    .limit(1);
  const code = fail(result);
  if (code || !result.data) throw new TaxesReadError(code ?? "no_data");
  const row = result.data[0];
  if (!row) return null;
  const parsed = officialSchema.parse(row);
  return { buy: parsed.buy, date: parsed.rate_date };
}

const exclusionSchema = z.union([
  z.object({ instrument_symbol: z.string(), holding_id: z.null() }),
  z.object({ instrument_symbol: z.null(), holding_id: z.string() }),
]);

// The assets the user left out of the report, as assetKey names them.
export async function readExclusions(
  client: Client,
): Promise<ReadonlySet<AssetKey>> {
  const result = await client
    .from("tax_report_exclusions")
    .select("instrument_symbol, holding_id")
    .limit(EXCLUSIONS_LIMIT);
  const code = fail(result);
  if (code || !result.data) throw new TaxesReadError(code ?? "no_data");
  return new Set(
    result.data.map((row) => {
      const parsed = exclusionSchema.parse(row);
      return assetKeyOf(
        parsed.instrument_symbol === null
          ? { holdingId: parsed.holding_id }
          : { instrumentSymbol: parsed.instrument_symbol },
      );
    }),
  );
}
