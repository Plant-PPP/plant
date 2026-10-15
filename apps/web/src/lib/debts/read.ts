import "server-only";
import {
  type Liability,
  type LiabilityEvent,
  liabilityEventSchema,
  liabilitySchema,
} from "@plant/core";
import type { Database } from "@plant/shared";
import type { SupabaseClient } from "@supabase/supabase-js";

import { PAGE_ROW_LIMIT } from "@/lib/portfolio-setup/limits";
import type { ListView } from "@/lib/portfolio-setup/read";
import { classifyPostgrestResult } from "@/lib/supabase/postgrest-write";
import {
  type Keyset,
  keysetFilter,
  readAllByKeyset,
} from "@/lib/supabase/keyset";

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
  "annual_rate:annual_rate::text, installments_left, next_due_on, matures_on, " +
  "accrues, opened_on, anchored_on";

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

const EVENT_COLUMNS =
  "id, liability_id, kind, date, amount:amount::text, " +
  "annual_rate:annual_rate::text, cash_holding_id, takes_cash, settles, created_at";

// PostgREST's max_rows: a page is never cut short by the server.
const EVENT_PAGE = 1000;
export const LIABILITY_EVENT_LIMIT = 5000;

// The user's debt events by debt, or one debt's, newest entered first, up to
// LIABILITY_EVENT_LIMIT; `cut` says the read stopped there, which leaves the
// figures of the debts concerned incomplete.
export async function readLiabilityEvents(
  client: Client,
  liabilityId?: string,
): Promise<{ byLiability: Map<string, LiabilityEvent[]>; cut: boolean }> {
  const page = async (after: Keyset | null) => {
    let query = client.from("liability_events").select(EVENT_COLUMNS);
    if (liabilityId !== undefined)
      query = query.eq("liability_id", liabilityId);
    if (after) {
      query = query
        .lte("created_at", after.at)
        .or(keysetFilter("created_at", after));
    }
    const result = await query
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(EVENT_PAGE);
    const failure = classifyPostgrestResult(
      result as Parameters<typeof classifyPostgrestResult>[0],
      200,
    );
    if (failure || !result.data) {
      throw new DebtsReadError(failure?.code ?? "no_data");
    }
    return (result.data as unknown[]).map((row) =>
      liabilityEventSchema.parse(row),
    );
  };
  const { rows, cut } = await readAllByKeyset(
    page,
    (row) => ({ at: row.created_at, id: row.id }),
    { pageSize: EVENT_PAGE, limit: LIABILITY_EVENT_LIMIT },
  );
  const byLiability = new Map<string, LiabilityEvent[]>();
  for (const event of rows) {
    const events = byLiability.get(event.liability_id) ?? [];
    events.push(event);
    byLiability.set(event.liability_id, events);
  }
  return { byLiability, cut };
}
