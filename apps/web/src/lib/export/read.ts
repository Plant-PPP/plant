import "server-only";
import type { Database } from "@plant/shared";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  HOLDING_COLUMNS,
  type HoldingRow,
  holdingRowOf,
} from "@/lib/holdings/read";
import { MAX_ROWS } from "@/lib/quotes/quote-reader";
import { keysetFilter, readAllByKeyset } from "@/lib/supabase/keyset";
import { classifyPostgrestResult } from "@/lib/supabase/postgrest-write";

const PAGE = 1000;
// The most rows an export reads of these holdings.
export const OTHER_HOLDINGS_LIMIT = 20_000;

// The most imports an export reads: one response holds them and the one past
// them, which says the export was cut.
export const EXPORT_IMPORTS_LIMIT = MAX_ROWS - 1;

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
  const { rows, cut } = await readAllByKeyset(
    async (after) => {
      let query = client
        .from("holdings")
        .select(`${HOLDING_COLUMNS}, created_at`)
        .neq("asset_class", "instrument")
        .is("archived_at", null);
      if (after) {
        query = query
          .lte("created_at", after.at)
          .or(keysetFilter("created_at", after));
      }
      const result = await query
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(PAGE);
      const failure = classifyPostgrestResult(
        result as Parameters<typeof classifyPostgrestResult>[0],
        200,
      );
      if (failure || !result.data) {
        throw new ExportReadError(failure?.code ?? "no_data");
      }
      return result.data as unknown as Record<string, unknown>[];
    },
    (row) => ({ at: String(row.created_at), id: String(row.id) }),
    { pageSize: PAGE, limit: OTHER_HOLDINGS_LIMIT },
  );
  return { rows: rows.map(holdingRowOf), truncated: cut };
}
