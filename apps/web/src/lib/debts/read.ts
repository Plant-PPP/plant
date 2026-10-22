import "server-only";
import {
  type LiabilitiesValue,
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

// What a debts view's line says about its figures, one rule for the list and
// a debt's page: complete only with every quote, every event and no balance
// past the limit.
export function debtsViewOutcome(
  valued: LiabilitiesValue,
  cut: boolean,
  overflowCount: number,
) {
  return {
    "plant.outcome":
      valued.complete && !cut && overflowCount === 0 ? "ok" : "incomplete",
    "plant.liability.events_truncated": cut,
    "plant.liability.overflow_count": overflowCount,
    "plant.liability.missing_count": valued.items.filter(
      (item) => item.value === null,
    ).length,
  };
}

export class DebtsReadError extends Error {
  constructor(readonly code: string) {
    super(`debts read failed: ${code}`);
  }
}

// Amounts are selected as text, so they stay exact decimal strings.
const COLUMNS =
  "id, kind, label, lender, currency, uva, instrument_symbol, " +
  "balance:balance::text, principal:principal::text, installment:installment::text, " +
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

// One of the user's debts, or null when the id is not one of theirs.
export async function readLiability(
  client: Client,
  id: string,
): Promise<Liability | null> {
  const result = await client
    .from("liabilities")
    .select(COLUMNS)
    .eq("id", id)
    .limit(1);
  const failure = classifyPostgrestResult(
    result as Parameters<typeof classifyPostgrestResult>[0],
    200,
  );
  if (failure || !result.data) {
    throw new DebtsReadError(failure?.code ?? "no_data");
  }
  const [row] = result.data as unknown[];
  return row === undefined ? null : liabilitySchema.parse(row);
}

// The holdings pledged for one of the user's debts.
export async function readCollateral(
  client: Client,
  liabilityId: string,
): Promise<string[]> {
  const result = await client
    .from("liability_collateral")
    .select("holding_id")
    .eq("liability_id", liabilityId)
    .order("created_at", { ascending: true });
  const failure = classifyPostgrestResult(
    result as Parameters<typeof classifyPostgrestResult>[0],
    200,
  );
  if (failure || !result.data) {
    throw new DebtsReadError(failure?.code ?? "no_data");
  }
  return result.data.map((row) => row.holding_id);
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

// A deposit that may be a loan's disbursement: units of the debt's
// instrument that came into one of the user's holdings, by the operation.
export type DisbursementOption = {
  operationId: string;
  date: string;
  quantity: string;
  // The account it came into, by its institution.
  institution: string;
};

// What a debt in units of an instrument says brought its money in, and the
// deposits of that instrument that could have: units in at a cost, newest
// first. A debt in a currency has none to choose.
export async function readDisbursement(
  client: Client,
  liabilityId: string,
  instrumentSymbol: string | null,
): Promise<{ current: string | null; options: DisbursementOption[] }> {
  // Every holding of the instrument, sold to zero ones too: a loan's units
  // are often spent at once.
  const held =
    instrumentSymbol === null
      ? { data: [], error: null }
      : await client
          .from("holdings")
          .select("id, source_connections!inner(institution)")
          .eq("instrument_symbol", instrumentSymbol)
          .is("archived_at", null)
          .limit(PAGE_ROW_LIMIT);
  if (held.error || !held.data) {
    throw new DebtsReadError(held.error?.code ?? "no_data");
  }
  const institutions = new Map(
    (
      held.data as unknown as {
        id: string;
        source_connections: { institution: string };
      }[]
    ).map((row) => [row.id, row.source_connections.institution]),
  );
  const holdingIds = [...institutions.keys()];
  const [debt, movements] = await Promise.all([
    client
      .from("liabilities")
      .select("disbursement_operation_id")
      .eq("id", liabilityId),
    holdingIds.length === 0
      ? null
      : client
          .from("movements")
          .select("operation_id, date, quantity:quantity::text, holding_id")
          .in("holding_id", [...holdingIds])
          .eq("kind", "adjustment")
          .eq("direction", "in")
          .gt("price", 0)
          .order("date", { ascending: false })
          .limit(PAGE_ROW_LIMIT),
  ]);
  const failure =
    classifyPostgrestResult(
      debt as Parameters<typeof classifyPostgrestResult>[0],
      200,
    ) ??
    (movements &&
      classifyPostgrestResult(
        movements as Parameters<typeof classifyPostgrestResult>[0],
        200,
      ));
  if (failure || !debt.data || (movements && !movements.data)) {
    throw new DebtsReadError(failure?.code ?? "no_data");
  }
  return {
    current: debt.data[0]?.disbursement_operation_id ?? null,
    options: (movements?.data ?? []).map((row) => ({
      operationId: row.operation_id,
      date: row.date,
      quantity: row.quantity as unknown as string,
      institution: institutions.get(row.holding_id) ?? "",
    })),
  };
}
