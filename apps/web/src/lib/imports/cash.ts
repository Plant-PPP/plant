import "server-only";
import {
  type Currency,
  currencySchema,
  type Database,
  exactOf,
  nonNegativeDecimalSchema,
  plus,
  stored,
} from "@plant/shared";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { MovementResult } from "@/lib/holdings/movements-input";
import type { ImportRow } from "@/lib/imports/review";
import { ImportsReadError } from "@/lib/imports/read";
import { classifyPostgrestResult } from "@/lib/supabase/postgrest-write";

type Client = SupabaseClient<Database>;

// One of the user's active cash holdings, its amount as the database prints
// it, which is how confirm_import compares what was read.
export type HeldCash = {
  id: string;
  accountId: string;
  currency: Currency;
  amount: string;
};

const heldCashSchema = z.object({
  id: z.string(),
  source_connection_id: z.string(),
  currency: currencySchema,
  amount: z.string(),
});

// The cash holdings as the review read them, sent back with its rows:
// confirm_import refuses as stale a balance whose cash changed since.
export const reviewedCashSchema = z
  .array(
    z
      .object({
        id: z.string().max(64),
        accountId: z.string().max(64),
        currency: currencySchema,
        amount: z.string().max(64),
      })
      .strict(),
  )
  .max(1_000);

// The user's active cash holdings.
export async function readHeldCash(client: Client): Promise<HeldCash[]> {
  const result = await client
    .from("holdings")
    .select("id, source_connection_id, currency, amount:amount::text")
    .eq("asset_class", "cash")
    .is("archived_at", null);
  const failure = classifyPostgrestResult(result, 200);
  if (failure || !result.data) {
    throw new ImportsReadError(failure?.code ?? "no_data");
  }
  return (result.data as unknown[]).map((data) => {
    const row = heldCashSchema.parse(data);
    return {
      id: row.id,
      accountId: row.source_connection_id,
      currency: row.currency,
      amount: row.amount,
    };
  });
}

// The cash an account holds in each currency, its holdings added up, and
// the currencies it holds in more than one.
export function cashIn(
  held: readonly HeldCash[],
  accountId: string,
): { held: Map<Currency, string>; several: Set<Currency> } {
  const sums = new Map<Currency, string>();
  const several = new Set<Currency>();
  for (const each of held) {
    if (each.accountId !== accountId) continue;
    const sum = sums.get(each.currency);
    if (sum !== undefined) several.add(each.currency);
    sums.set(
      each.currency,
      stored(plus(exactOf(sum ?? "0"), exactOf(each.amount))),
    );
  }
  return { held: sums, several };
}

// A cash balance as confirm_import takes it.
export type CashEntry = {
  cash: {
    source_connection_id: string;
    currency: Currency;
    amount: string;
    expected: Record<string, string>;
  };
};

// A balance at zero brings the account's cash in its currency to zero.
const cashRowSchema = z.object({
  quantity: nonNegativeDecimalSchema,
  currency: currencySchema,
  accountLabel: z.string().optional(),
  accountId: z.string().min(1).optional(),
});

// The cash balances the review kept, each as the amount of its account's
// cash in its currency, with that cash as it was read. A balance the review
// did not route, two in one account's currency, or one where the account
// holds several cash holdings in that currency (which the user sets by hand)
// is refused, and so is an account that is not one of `accounts`.
export function cashEntries(
  rows: readonly ImportRow[],
  importAccountId: string,
  accounts: ReadonlySet<string>,
  held: readonly HeldCash[],
):
  | { ok: true; entries: CashEntry[] }
  | { ok: false; code: Extract<MovementResult, { ok: false }>["code"] } {
  const entries: CashEntry[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (row.discarded || row.assetClass !== "cash") continue;
    const parsed = cashRowSchema.safeParse(row);
    if (
      !parsed.success ||
      (parsed.data.accountLabel !== undefined &&
        parsed.data.accountId === undefined)
    ) {
      return { ok: false, code: "invalid" };
    }
    const { quantity, currency } = parsed.data;
    const accountId = parsed.data.accountId ?? importAccountId;
    if (!accounts.has(accountId)) return { ok: false, code: "not_found" };
    const key = `${accountId}|${currency}`;
    if (seen.has(key)) return { ok: false, code: "invalid" };
    seen.add(key);
    const read = held.filter(
      (each) => each.accountId === accountId && each.currency === currency,
    );
    if (read.length > 1) return { ok: false, code: "invalid" };
    entries.push({
      cash: {
        source_connection_id: accountId,
        currency,
        amount: quantity,
        expected: Object.fromEntries(
          read.map((each) => [each.id, each.amount]),
        ),
      },
    });
  }
  return { ok: true, entries };
}
