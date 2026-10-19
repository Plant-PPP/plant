import "server-only";
import {
  admitCashHistory,
  type CashMovement,
  instrumentIndex,
  type MovementRates,
  movementRatesSchema,
  snapshotOn,
  VALUED_FX_KINDS,
} from "@plant/core";
import { readIolMovements } from "@plant/sources";
import {
  buenosAiresDate,
  type Currency,
  currencySchema,
  type Database,
  decimalStringSchema,
  negated,
  exactOf,
  stored,
} from "@plant/shared";
import type { SupabaseClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getSessionClaims } from "@/lib/auth/session-claims";
import { writeImportOperations } from "@/lib/imports/confirm-operations";
import type { Ledger } from "@/lib/ledger/ledger";
import { LedgerReadError } from "@/lib/ledger/read";
import {
  expectedRevisions,
  operationSymbols,
  rpcPartsOf,
} from "@/lib/ledger/rpc-parts";
import {
  ledgerForDates,
  refreshGainAlerts,
  rpcFailure,
} from "@/lib/ledger/write";
import { serverLog } from "@/lib/log/server-log";
import { REQUEST_ID_FIELD } from "@/lib/request-id";
import { currentRequestId } from "@/lib/request-id-server";
import { classifyPostgrestResult } from "@/lib/supabase/postgrest-write";
import { createClient } from "@/lib/supabase/server";

import {
  CASH_ENTRY_KINDS,
  type CashResult,
  type StatementResult,
} from "./input";
import { cashHoldingsOf, readCashMovements, sideOf } from "./read";
import { planStatement } from "./statement";

type Client = SupabaseClient<Database>;

const EVENT = "cash.write";

type CashAction = "write_cash" | "import_statement";

function log(
  action: CashAction,
  fields: {
    outcome: string;
    requestId: string | undefined;
    userId: string;
    started: number;
    count?: number;
  },
  error?: unknown,
): void {
  const line = {
    [REQUEST_ID_FIELD]: fields.requestId,
    "enduser.id": fields.userId,
    "plant.cash.action": action,
    "plant.cash.count": fields.count,
    "plant.cash.duration_ms": Math.round(performance.now() - fields.started),
    "plant.outcome": fields.outcome,
  };
  if (fields.outcome === "failed") serverLog.error(EVENT, line, error);
  else if (fields.outcome === "ok") serverLog.info(EVENT, line);
  else serverLog.warn(EVENT, line);
}

// The dollars' selling rates on a day as a movement carries them, the euro's
// too for euros; null when the stored quotes miss one.
function ratesOn(
  ledger: Ledger,
  date: string,
  currency: Currency,
): MovementRates | null {
  const { eur, ...dollars } = snapshotOn(ledger.quotes, date, {
    fxKinds: VALUED_FX_KINDS,
    symbols: [],
  }).snapshot.fx;
  const parsed = movementRatesSchema.safeParse(
    currency === "EUR" ? { ...dollars, eur } : dollars,
  );
  return parsed.success ? parsed.data : null;
}

// A cash holding for the account in that currency, in its default
// portfolio, at 0 until its history moves it.
async function createCash(
  client: Client,
  ledger: Ledger,
  accountId: string,
  currency: Currency,
): Promise<string> {
  const account = ledger.accounts.find((each) => each.id === accountId)!;
  const result = await client
    .from("holdings")
    .insert({
      source_connection_id: accountId,
      portfolio_id: account.portfolio.id,
      asset_class: "cash",
      currency,
      amount: 0,
    })
    .select("id")
    .single();
  if (classifyPostgrestResult(result, 201) || !result.data) {
    throw new LedgerReadError("holdings", "cash_insert");
  }
  return result.data.id;
}

type Insert = {
  kind: CashMovement["kind"];
  date: string;
  amount: string;
  operation_id: string | null;
  reference: string | null;
  note: string | null;
  rates: MovementRates;
};

const CASH_HINTS = [
  "negative_cash",
  "before_opening",
  "other_account",
  "stale",
] as const;

async function sendCash(
  client: Client,
  holdingId: string,
  inserts: readonly Insert[],
  deletes: readonly string[],
): Promise<CashResult & { failure?: unknown }> {
  const response = await client.rpc("write_cash_movements", {
    p_holding_id: holdingId,
    p_inserts:
      inserts as unknown as Database["public"]["Functions"]["write_cash_movements"]["Args"]["p_inserts"],
    p_deletes: [...deletes],
  });
  if (!classifyPostgrestResult(response, 200)) return { ok: true };
  const hint = response.error?.hint;
  const known = CASH_HINTS.find((each) => each === hint);
  if (known) return { ok: false, code: known };
  if (response.error?.code === "PT404") return { ok: false, code: "not_found" };
  return { ok: false, code: "failed", failure: response.error };
}

const entrySchema = z
  .object({
    kind: z.enum(CASH_ENTRY_KINDS),
    date: z.iso.date(),
    amount: decimalStringSchema,
    note: z.string().trim().min(1).max(200).nullable(),
  })
  .strict();

const cashInputSchema = z
  .object({
    accountId: z.uuid(),
    currency: currencySchema,
    inserts: z.array(entrySchema).max(20),
    deletes: z.array(z.uuid()).max(20),
  })
  .strict();

// Records, or deletes, movements of an account's cash in one currency, typed
// by the user: amounts come positive and a withdrawal goes out. A currency
// with no cash holding gets one.
export async function writeCash(input: unknown): Promise<CashResult> {
  const claims = await getSessionClaims();
  const started = performance.now();
  const fields = {
    requestId: await currentRequestId(),
    userId: claims.sub,
    started,
  };
  const parsed = cashInputSchema.safeParse(input);
  if (!parsed.success) {
    log("write_cash", { ...fields, outcome: "invalid" });
    return { ok: false, code: "invalid" };
  }
  const { accountId, currency, inserts, deletes } = parsed.data;
  let result: CashResult;
  let failure: unknown;
  try {
    const client: Client = await createClient();
    const today = buenosAiresDate(new Date());
    const [{ ledger }, holdings, histories] = await Promise.all([
      ledgerForDates(
        client,
        inserts.map((each) => each.date),
      ),
      cashHoldingsOf(client, accountId),
      readCashMovements(client),
    ]);
    const side = sideOf(holdings, histories.byHolding, currency);
    const rows: Insert[] = [];
    let refused: CashResult | null = null;
    for (const entry of inserts) {
      const rates = ratesOn(ledger, entry.date, currency);
      if (!rates) {
        refused = { ok: false, code: "no_rate" };
        break;
      }
      const amount = exactOf(entry.amount);
      if (
        amount.n < 0n ||
        (amount.n === 0n && entry.kind !== "opening_balance")
      ) {
        refused = { ok: false, code: "invalid" };
        break;
      }
      rows.push({
        kind: entry.kind,
        date: entry.date,
        amount:
          entry.kind === "withdrawal" ? stored(negated(amount)) : entry.amount,
        operation_id: null,
        reference: null,
        note: entry.note,
        rates,
      });
    }
    const after = [
      ...side.history.filter((each) => !deletes.includes(each.id)),
      ...rows,
    ];
    const admission = admitCashHistory(after, today);
    if (!ledger.accounts.some((each) => each.id === accountId)) {
      result = { ok: false, code: "not_found" };
    } else if (refused) {
      result = refused;
    } else if (admission) {
      result = { ok: false, code: admission };
    } else {
      const holdingId =
        side.holdingId ??
        (await createCash(client, ledger, accountId, currency));
      ({ failure, ...result } = await sendCash(
        client,
        holdingId,
        rows,
        deletes,
      ));
    }
  } catch (error) {
    result = { ok: false, code: "failed" };
    failure = error;
  }
  log(
    "write_cash",
    { ...fields, outcome: result.ok ? "ok" : result.code },
    failure,
  );
  if (result.ok || result.code !== "invalid") revalidatePath("/", "layout");
  return result;
}

const statementSchema = z
  .object({
    accountId: z.uuid(),
    fileName: z.string().trim().min(1).max(120),
    text: z.string().max(5 * 1024 * 1024),
    confirm: z.boolean(),
  })
  .strict();

// Reads a broker's statement of an account's money and, once confirmed,
// writes it: the operations Plant lacks, then each currency's cash history,
// with the opening balance a currency with none takes. Read again, it adds
// nothing.
export async function importStatement(
  input: unknown,
): Promise<StatementResult> {
  const claims = await getSessionClaims();
  const started = performance.now();
  const fields = {
    requestId: await currentRequestId(),
    userId: claims.sub,
    started,
  };
  const parsed = statementSchema.safeParse(input);
  if (!parsed.success) {
    log("import_statement", { ...fields, outcome: "invalid" });
    return { ok: false, code: "invalid" };
  }
  const { accountId, fileName, text, confirm } = parsed.data;
  const read = readIolMovements(text);
  if (!read.ok) {
    log("import_statement", { ...fields, outcome: read.code });
    return { ok: false, code: read.code };
  }
  let result: StatementResult;
  let failure: unknown;
  let count = 0;
  try {
    const client: Client = await createClient();
    const dates = read.rows.map((row) => row.date);
    const reread = async () => {
      const read = await ledgerForDates(client, dates);
      if (read.truncated) throw new LedgerReadError("movements", "truncated");
      return read;
    };
    let { ledger, symbolOf } = await reread();
    if (!ledger.accounts.some((each) => each.id === accountId)) {
      result = { ok: false, code: "not_found" };
    } else {
      const [holdings, histories] = await Promise.all([
        cashHoldingsOf(client, accountId),
        readCashMovements(client),
      ]);
      const cash = new Map(
        (["ARS", "USD"] as Currency[]).map((currency) => [
          currency,
          sideOf(holdings, histories.byHolding, currency),
        ]),
      );
      const index = instrumentIndex(
        ledger.instruments.map((each) => ({
          ...each,
          aliases: (each as { aliases?: string[] }).aliases ?? [],
        })),
      );
      const plan = planStatement(read.rows, { ledger, accountId, cash, index });
      const short = [...plan.openings].find(
        ([, opening]) => exactOf(opening.amount).n < 0n,
      );
      const summary = {
        from: plan.from,
        to: plan.to,
        rows: read.rows.length,
        skipped: read.skipped + plan.skipped,
        matched: plan.matched,
        created: plan.create.length,
        known: plan.known,
        cash: [...plan.cash].map(([currency, movements]) => ({
          currency,
          count: movements.length,
          opening: plan.openings.get(currency)?.amount ?? null,
        })),
      };
      if (short) {
        result = { ok: false, code: "negative_cash", summary };
      } else if (!confirm) {
        result = { ok: true, written: false, summary };
      } else {
        result = { ok: true, written: true, summary };
        // Each operation Plant lacks, written against the ledger as it
        // stands after the last, with the rates its legs take.
        const created = new Map<string, { id: string; rates: MovementRates }>();
        for (const row of plan.create) {
          const written = writeImportOperations(
            ledger,
            { id: accountId, accountId, date: row.date!, fileName },
            [row],
            () => crypto.randomUUID(),
          );
          if (!written.result.ok) {
            result = { ok: false, code: "failed", summary };
            break;
          }
          const operationId = written.operations[0]!;
          const parts = rpcPartsOf(written.state, operationId);
          const response = await client.rpc("write_operation", {
            p_operation_id: null as unknown as string,
            p_parts: parts,
            p_expected: expectedRevisions(
              ledger.revisions,
              symbolOf,
              operationSymbols(written.state, operationId),
            ),
          });
          if (classifyPostgrestResult(response, 200) || !response.data) {
            const code = rpcFailure(response.error ?? {});
            failure = response.error;
            result = {
              ok: false,
              code: code === "failed" ? "failed" : "stale",
              summary,
            };
            break;
          }
          created.set(row.reference!, {
            id: response.data,
            rates: parts[0]!.rates,
          });
          count += 1;
          ({ ledger, symbolOf } = await reread());
        }
        // The rates of each operation's movements, which its legs take.
        const ratesOf = new Map<string, MovementRates>();
        for (const movements of ledger.movements.values()) {
          for (const movement of movements) {
            ratesOf.set(movement.operation_id, movement.rates);
          }
        }
        for (const [currency, movements] of plan.cash) {
          if (!result.ok) break;
          const side = cash.get(currency)!;
          const inserts: Insert[] = [];
          const opening = plan.openings.get(currency);
          if (opening) {
            const rates = ratesOn(ledger, opening.date, currency);
            if (!rates) {
              result = { ok: false, code: "no_rate", summary };
              break;
            }
            inserts.push({
              kind: "opening_balance",
              date: opening.date,
              amount: opening.amount,
              operation_id: null,
              reference: null,
              note: `Saldo antes de ${fileName}`.slice(0, 200),
              rates,
            });
          }
          for (const movement of movements) {
            const operation =
              movement.operation === null
                ? null
                : "id" in movement.operation
                  ? movement.operation.id
                  : (created.get(movement.operation.number)?.id ?? null);
            if (movement.operation !== null && operation === null) continue;
            const rates =
              (operation && ratesOf.get(operation)) ??
              ratesOn(ledger, movement.date, currency);
            if (!rates) {
              result = { ok: false, code: "no_rate", summary };
              break;
            }
            inserts.push({
              kind: movement.kind,
              date: movement.date,
              amount: movement.amount,
              operation_id: operation,
              reference: movement.reference,
              note: null,
              rates,
            });
          }
          if (!result.ok) break;
          const holdingId =
            side.holdingId ??
            (await createCash(client, ledger, accountId, currency));
          const sent = await sendCash(client, holdingId, inserts, []);
          if (!sent.ok) {
            failure = sent.failure;
            result = { ok: false, code: sent.code, summary };
            break;
          }
          count += inserts.length;
        }
      }
    }
  } catch (error) {
    result = { ok: false, code: "failed" };
    failure = error;
  }
  log(
    "import_statement",
    { ...fields, count, outcome: result.ok ? "ok" : result.code },
    failure,
  );
  if (confirm && count > 0) {
    await refreshGainAlerts(fields.userId);
    revalidatePath("/", "layout");
  }
  return result;
}
