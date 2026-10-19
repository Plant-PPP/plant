import "server-only";
import type { Currency, Database } from "@plant/shared";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { CashSideView } from "@/components/holdings/cash-history";
import { MOVEMENT_KIND_LABELS } from "@/lib/holdings/messages";
import { allRows, type Ledger } from "@/lib/ledger/ledger";

import { cashHoldingsOf, readCashMovements, sideOf } from "./read";

// An account's cash as its page lists it, a currency per holding it has,
// open or with a history: today's amount and its movements, newest first, an
// operation's leg named by what the operation was.
export async function accountCash(
  client: SupabaseClient<Database>,
  accountId: string,
  ledger: Ledger,
): Promise<CashSideView[]> {
  const [holdings, histories] = await Promise.all([
    cashHoldingsOf(client, accountId),
    readCashMovements(client),
  ]);
  const operations = new Map<string, string>();
  for (const row of allRows(ledger)) {
    if (row.holding.asset_class !== "instrument") continue;
    for (const movement of ledger.movements.get(row.id) ?? []) {
      operations.set(
        movement.operation_id,
        `${MOVEMENT_KIND_LABELS[movement.kind]} ${row.holding.instrument_symbol}`,
      );
    }
  }
  const currencies = [
    ...new Set(
      holdings
        .filter((each) => !each.archived_at || histories.byHolding.has(each.id))
        .map((each) => each.currency),
    ),
  ].sort() as Currency[];
  return currencies.flatMap((currency) => {
    const side = sideOf(holdings, histories.byHolding, currency);
    if (side.holdingId === null) return [];
    return [
      {
        currency,
        balance: side.today,
        lines: [...side.history].reverse().map((movement) => ({
          id: movement.id,
          kind: movement.kind,
          date: movement.date,
          amount: movement.amount,
          detail:
            movement.operation_id !== null
              ? (operations.get(movement.operation_id) ?? null)
              : movement.note,
        })),
      },
    ];
  });
}
