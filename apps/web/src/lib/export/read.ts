import "server-only";
import type { Database } from "@plant/shared";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  HOLDING_COLUMNS,
  type HoldingRow,
  holdingRowOf,
} from "@/lib/holdings/read";
import { classifyPostgrestResult } from "@/lib/supabase/postgrest-write";

const PAGE = 1000;
// The most rows an export reads of these holdings.
export const OTHER_HOLDINGS_LIMIT = 20_000;

export class ExportReadError extends Error {
  constructor(readonly code: string) {
    super(`export read failed: ${code}`);
  }
}

// The user's holdings that are not an instrument (cash, a placement at a
// rate, a property, anything else), every one still listed, under RLS; and
// whether they were cut at OTHER_HOLDINGS_LIMIT.
export async function readOtherHoldings(
  client: SupabaseClient<Database>,
): Promise<{ rows: HoldingRow[]; truncated: boolean }> {
  const rows: HoldingRow[] = [];
  for (let from = 0; from < OTHER_HOLDINGS_LIMIT; from += PAGE) {
    const result = await client
      .from("holdings")
      .select(HOLDING_COLUMNS)
      .neq("asset_class", "instrument")
      .is("archived_at", null)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, from + PAGE - 1);
    const failure = classifyPostgrestResult(
      result as Parameters<typeof classifyPostgrestResult>[0],
      200,
    );
    if (failure || !result.data) {
      throw new ExportReadError(failure?.code ?? "no_data");
    }
    const page = result.data as unknown as Record<string, unknown>[];
    rows.push(...page.map(holdingRowOf));
    if (page.length < PAGE) return { rows, truncated: false };
  }
  return { rows, truncated: true };
}
