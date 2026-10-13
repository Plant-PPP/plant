import "server-only";
import { type Liability, liabilitySchema } from "@plant/core";
import type { Database } from "@plant/shared";
import type { SupabaseClient } from "@supabase/supabase-js";

import { PAGE_ROW_LIMIT } from "@/lib/portfolio-setup/limits";
import type { ListView } from "@/lib/portfolio-setup/read";
import { classifyPostgrestResult } from "@/lib/supabase/postgrest-write";

type Client = SupabaseClient<Database>;

export const DEBTS_VIEW_EVENT = "liabilities.view";

export class DebtsReadError extends Error {
  constructor(readonly code: string) {
    super(`debts read failed: ${code}`);
  }
}

// Amounts are selected as text, so they stay exact decimal strings.
const COLUMNS =
  "id, kind, label, lender, currency, uva, instrument_symbol, " +
  "balance:balance::text, installment:installment::text, " +
  "annual_rate:annual_rate::text, installments_left, next_due_on, matures_on";

// The user's debts, newest first, up to PAGE_ROW_LIMIT. Debts are deleted,
// never archived, so the archived list is always empty.
export async function readLiabilities(
  client: Client,
): Promise<ListView<Liability>> {
  const result = await client
    .from("liabilities")
    .select(COLUMNS)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(PAGE_ROW_LIMIT + 1);
  const failure = classifyPostgrestResult(
    result as Parameters<typeof classifyPostgrestResult>[0],
    200,
  );
  if (failure || !result.data) {
    throw new DebtsReadError(failure?.code ?? "no_data");
  }
  const rows = (result.data as unknown[]).map((row) =>
    liabilitySchema.parse(row),
  );
  return {
    active: rows.slice(0, PAGE_ROW_LIMIT),
    activeTruncated: rows.length > PAGE_ROW_LIMIT,
    archived: [],
    archivedPage: null,
    archivedFirstHref: null,
    archivedNextHref: null,
  };
}
