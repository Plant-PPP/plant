import "server-only";
import { type CashMovement, cashMovementSchema } from "@plant/core";
import type { Currency, Database } from "@plant/shared";
import type { SupabaseClient } from "@supabase/supabase-js";

import { MAX_ROWS } from "@/lib/quotes/quote-reader";
import { keysetFilter, readAllByKeyset } from "@/lib/supabase/keyset";
import { classifyPostgrestResult } from "@/lib/supabase/postgrest-write";

import type { CashSide } from "./statement";

type Client = SupabaseClient<Database>;

// More cash movements than a broker account lists in years; past it the read
// is cut and the closes say so.
export const CASH_MOVEMENT_LIMIT = 20_000;

export class CashReadError extends Error {
  constructor(readonly code: string) {
    super(`cash movements read failed: ${code}`);
  }
}

// Amounts are selected as text, so they stay exact decimal strings.
const COLUMNS =
  "id, holding_id, operation_id, kind, date, amount:amount::text, reference, note, rates, created_at";

type Row = Record<string, unknown> & { created_at: string; id: string };

// A history in the order it happened: by day, then as it was written.
const byOrder = (a: Row, b: Row) =>
  String(a.date) < String(b.date)
    ? -1
    : String(a.date) > String(b.date)
      ? 1
      : a.created_at < b.created_at
        ? -1
        : a.created_at > b.created_at
          ? 1
          : a.id < b.id
            ? -1
            : 1;

// Every cash movement of the user's, by holding, oldest first; `cut` when
// there were more than CASH_MOVEMENT_LIMIT.
export async function readCashMovements(client: Client): Promise<{
  byHolding: Map<string, CashMovement[]>;
  cut: boolean;
}> {
  const { rows, cut } = await readAllByKeyset<Row>(
    async (after) => {
      let query = client.from("cash_movements").select(COLUMNS);
      if (after) {
        query = query
          .lte("created_at", after.at)
          .or(keysetFilter("created_at", after));
      }
      const result = await query
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(MAX_ROWS);
      const failure = classifyPostgrestResult(result, 200);
      if (failure || !result.data) {
        throw new CashReadError(failure?.code ?? "no_data");
      }
      return result.data as unknown as Row[];
    },
    (row) => ({ at: row.created_at, id: row.id }),
    { pageSize: MAX_ROWS, limit: CASH_MOVEMENT_LIMIT },
  );
  const byHolding = new Map<string, CashMovement[]>();
  for (const row of [...rows].sort(byOrder)) {
    const movement = cashMovementSchema.parse({
      id: row.id,
      holding_id: row.holding_id,
      operation_id: row.operation_id,
      kind: row.kind,
      date: row.date,
      amount: row.amount,
      reference: row.reference,
      note: row.note,
      rates: row.rates,
    });
    const own = byHolding.get(movement.holding_id) ?? [];
    own.push(movement);
    byHolding.set(movement.holding_id, own);
  }
  return { byHolding, cut };
}

// The account's cash holdings, open or archived.
export async function cashHoldingsOf(client: Client, accountId: string) {
  const result = await client
    .from("holdings")
    .select("id, currency, amount:amount::text, archived_at, created_at")
    .eq("source_connection_id", accountId)
    .eq("asset_class", "cash")
    .order("created_at")
    .order("id");
  if (classifyPostgrestResult(result, 200) || !result.data) {
    throw new CashReadError("holdings");
  }
  return result.data as unknown as {
    id: string;
    currency: Currency;
    amount: string;
    archived_at: string | null;
  }[];
}

// The account's cash in one currency: the holding with a history, open
// first, else its oldest open one, else none.
export function sideOf(
  holdings: Awaited<ReturnType<typeof cashHoldingsOf>>,
  histories: ReadonlyMap<string, CashMovement[]>,
  currency: Currency,
): CashSide {
  const own = holdings.filter((each) => each.currency === currency);
  const chosen =
    own.find((each) => histories.has(each.id) && !each.archived_at) ??
    own.find((each) => histories.has(each.id)) ??
    own.find((each) => !each.archived_at);
  if (!chosen) return { holdingId: null, today: "0", history: [] };
  return {
    holdingId: chosen.id,
    today: chosen.archived_at ? "0" : chosen.amount,
    history: histories.get(chosen.id) ?? [],
  };
}
