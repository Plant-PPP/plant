import "server-only";
import {
  admitManualPrice,
  isDenominator,
  manualPriceSchema,
  type MovementCursor,
  type ManualPrice,
  QUOTE_CARRY_DAYS,
  type ReferenceDollar,
  UNIT_FX_KINDS,
} from "@plant/core";
import {
  addDays,
  daysBetween,
  buenosAiresDate,
  Constants,
  type Database,
} from "@plant/shared";
import type { SupabaseClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { syncGainAlerts } from "@/lib/alerts/read";
import { getSessionClaims } from "@/lib/auth/session-claims";
import type {
  MovementResult,
  MovementScope,
  MovementsPage,
} from "@/lib/holdings/movements-input";
import type { HoldingDeleteResult } from "@/lib/holdings/delete-result";
import type { PriceResult } from "@/lib/holdings/price-input";
import { serverLog } from "@/lib/log/server-log";
import { createQuoteReader } from "@/lib/quotes/quote-reader";
import { REQUEST_ID_FIELD } from "@/lib/request-id";
import { currentRequestId } from "@/lib/request-id-server";
import { classifyPostgrestResult } from "@/lib/supabase/postgrest-write";
import { createClient } from "@/lib/supabase/server";

import { holdingInsertSchema } from "@/lib/holdings/schemas";
import type { WriteResult } from "@/lib/portfolio-setup/write-result";

import {
  createHolding,
  deleteOperation,
  type Ledger,
  movementsPage,
  priceOn,
  suggestedTransferCost,
  writeOperation,
} from "./ledger";
import { LedgerReadError, readLedger } from "./read";
import { expectedRevisions, operationSymbols, rpcPartsOf } from "./rpc-parts";

type Client = SupabaseClient<Database>;

export type LedgerAction =
  | "create_operation"
  | "update_operation"
  | "delete_operation"
  | "load_movements"
  | "suggest_transfer_cost"
  | "quote_on"
  | "delete_holding"
  | "create_instrument_holding"
  | "set_manual_price"
  | "delete_manual_price";

const EVENT = "ledger.write";

function log(
  action: LedgerAction,
  fields: {
    outcome: string;
    requestId: string | undefined;
    userId: string;
    started: number;
  },
  error?: unknown,
): void {
  const line = {
    [REQUEST_ID_FIELD]: fields.requestId,
    "enduser.id": fields.userId,
    "plant.ledger.action": action,
    "plant.ledger.duration_ms": Math.round(performance.now() - fields.started),
    "plant.outcome": fields.outcome,
  };
  if (fields.outcome === "failed") serverLog.error(EVENT, line, error);
  else if (fields.outcome === "ok") serverLog.info(EVENT, line);
  else serverLog.warn(EVENT, line);
}

async function referenceDollarOf(client: Client): Promise<ReferenceDollar> {
  const result = await client
    .from("profiles")
    .select("reference_dollar")
    .single();
  if (classifyPostgrestResult(result, 200) || !result.data) {
    throw new LedgerReadError("accounts", "no_profile");
  }
  return result.data.reference_dollar;
}

// The stored dollar rates a movement dated `date` takes.
const dateOf = z.object({ date: z.iso.date() });

// The ledger with the stored dollar rates of the date an operation dated
// `input.date` takes, when it has one.
export async function ledgerFor(client: Client, input: unknown) {
  const date = dateOf.safeParse(input);
  return ledgerForDates(client, date.success ? [date.data.date] : []);
}

// The days one quote read covers: what the reader takes for the dollar kinds
// a unit needs, less the week each day carries back.
const QUOTE_STRETCH_DAYS = 300;

// The user's ledger with the dollar rates operations on these days need,
// from a week before each to it, up to today.
export async function ledgerForDates(client: Client, dates: readonly string[]) {
  const today = buenosAiresDate(new Date());
  const past = [...new Set(dates)].filter((date) => date <= today).sort();
  // One read per stretch of days the reader takes at once.
  const stretches: { from: string; to: string }[] = [];
  for (const date of past) {
    const last = stretches.at(-1);
    if (last && daysBetween(last.from, date) < QUOTE_STRETCH_DAYS) {
      last.to = date;
    } else {
      stretches.push({ from: addDays(date, -QUOTE_CARRY_DAYS), to: date });
    }
  }
  const reader = createQuoteReader(client);
  const read = await Promise.all(
    stretches.map((stretch) =>
      reader.read({ ...stretch, fxKinds: [...UNIT_FX_KINDS], symbols: [] }),
    ),
  );
  const quotes =
    read.length > 0
      ? {
          fxRates: read.flatMap((each) => each.fxRates),
          prices: read.flatMap((each) => each.prices),
        }
      : undefined;
  return readLedger(client, {
    today,
    referenceDollar: await referenceDollarOf(client),
    quotes,
  });
}

// Works the user's gain alerts' figures out again after their movements
// changed; a failure is logged and leaves the old figures until the next
// write.
export async function refreshGainAlerts(userId: string): Promise<void> {
  try {
    const client: Client = await createClient();
    await syncGainAlerts(
      client,
      async (dates) => (await ledgerForDates(client, dates)).ledger,
    );
  } catch (error) {
    serverLog.error(
      "alerts.gain_sync",
      { "enduser.id": userId, "plant.outcome": "failed" },
      error,
    );
  }
}

// Whether the operation as written takes the next entry order, as a new one
// would: an edit that moved to another day and went last on it.
function goesLast(
  state: Ledger,
  operationId: string,
  read: Pick<Ledger, "nextEntryOrder">,
): boolean {
  for (const movements of state.movements.values()) {
    const movement = movements.find(
      (each) => each.operation_id === operationId,
    );
    if (movement) return movement.entry_order >= read.nextEntryOrder;
  }
  return false;
}

// What write_operation's refusal means to the dialog. A stale read or a
// history below zero only follows a race, since the app admitted the
// operation against what it read: the user tries again.
export function rpcFailure(error: {
  code?: string;
  hint?: string | null;
}): Extract<MovementResult, { ok: false }>["code"] {
  if (error.code === "PT404" || error.code === "23503") return "not_found";
  // A history the app admitted but the database finds below zero: a write
  // that landed in between. Retrying against it gets the same answer.
  if (error.hint === "negative_units") return "oversold";
  if (
    error.hint === "portfolio_archived" ||
    error.hint === "source_connection_archived"
  ) {
    return error.hint;
  }
  return "failed";
}

// Creates, rewrites (an id and an input) or deletes (an id and no input) an
// operation: admitted by core against the user's ledger, then written by
// write_operation with the revisions it read.
export async function runOperation(
  action: Extract<
    LedgerAction,
    "create_operation" | "update_operation" | "delete_operation"
  >,
  operationId: unknown,
  input: unknown,
): Promise<MovementResult> {
  // Outside any try: its redirect to /login or /auth/mfa must propagate.
  const claims = await getSessionClaims();
  const started = performance.now();
  const requestId = await currentRequestId();
  const fields = { requestId, userId: claims.sub, started };

  const id =
    action === "create_operation"
      ? null
      : (z.uuid().safeParse(operationId).data ?? undefined);
  if (id === undefined) {
    log(action, { ...fields, outcome: "invalid" });
    return { ok: false, code: "invalid" };
  }

  let result: MovementResult;
  let failure: unknown;
  try {
    const client: Client = await createClient();
    const { ledger, truncated, symbolOf } = await ledgerFor(client, input);
    if (truncated) throw new LedgerReadError("movements", "truncated");
    const target = id ?? crypto.randomUUID();
    const written =
      action === "delete_operation"
        ? deleteOperation(ledger, target)
        : writeOperation(ledger, input, {
            operationId: target,
            replacing: id !== null,
            newId: () => crypto.randomUUID(),
          });
    if (!written.result.ok) {
      result = written.result;
    } else {
      const symbols = new Set([
        ...operationSymbols(ledger, target),
        ...operationSymbols(written.state, target),
      ]);
      const response = await client.rpc("write_operation", {
        // A new operation's id is the database's.
        p_operation_id: id as string,
        p_parts: rpcPartsOf(written.state, target),
        p_expected: expectedRevisions(ledger.revisions, symbolOf, symbols),
        // An edit admitted last on its day takes the next place there too.
        p_last: id !== null && goesLast(written.state, target, ledger),
      });
      if (classifyPostgrestResult(response, 200)) {
        result = { ok: false, code: rpcFailure(response.error ?? {}) };
        if (result.code === "failed") failure = response.error;
      } else {
        result = { ok: true, id: response.data ?? target };
      }
    }
  } catch (error) {
    result = { ok: false, code: "failed" };
    failure = error;
  }
  log(action, { ...fields, outcome: result.ok ? "ok" : result.code }, failure);
  if (result.ok) await refreshGainAlerts(fields.userId);
  // Anything but a malformed request may mean the page is out of date.
  if (result.ok || result.code !== "invalid")
    revalidatePath("/assets", "layout");
  return result;
}

const scopeSchema: z.ZodType<MovementScope> = z.union([
  z.object({ holdingId: z.uuid() }).strict(),
  z.object({ accountId: z.uuid() }).strict(),
  z.object({ portfolioId: z.uuid() }).strict(),
  z.object({ symbol: z.string().regex(/^[A-Z0-9]{1,15}$/) }).strict(),
]);

const cursorSchema: z.ZodType<MovementCursor> = z
  .object({ date: z.iso.date(), rank: z.number().int(), id: z.uuid() })
  .strict();

// A page of a scope's movements in a unit, newest first, after a cursor.
export async function loadMovementsPage(
  scope: unknown,
  unit: unknown,
  cursor: unknown,
): Promise<MovementsPage> {
  const claims = await getSessionClaims();
  const started = performance.now();
  const fields = {
    requestId: await currentRequestId(),
    userId: claims.sub,
    started,
  };
  const parsedScope = scopeSchema.safeParse(scope);
  const parsedCursor = cursorSchema.nullable().safeParse(cursor);
  if (
    !parsedScope.success ||
    !parsedCursor.success ||
    typeof unit !== "string" ||
    !isDenominator(unit)
  ) {
    log("load_movements", { ...fields, outcome: "invalid" });
    return { ok: false, code: "failed" };
  }
  try {
    const client: Client = await createClient();
    const { ledger } = await readLedger(client, {
      today: buenosAiresDate(new Date()),
      referenceDollar: await referenceDollarOf(client),
    });
    const page = movementsPage(
      ledger,
      parsedScope.data,
      unit,
      parsedCursor.data,
    );
    log("load_movements", { ...fields, outcome: "ok" });
    return page;
  } catch (error) {
    log("load_movements", { ...fields, outcome: "failed" }, error);
    return { ok: false, code: "failed" };
  }
}

// What a transfer's units would carry if their cost were left to them,
// worked out as the write would: null when it cannot be written.
export async function suggestTransferCost(
  query: unknown,
): Promise<string | null> {
  const claims = await getSessionClaims();
  const fields = {
    requestId: await currentRequestId(),
    userId: claims.sub,
    started: performance.now(),
  };
  const parsed = z
    .object({ input: z.unknown(), operationId: z.uuid().nullable() })
    .safeParse(query);
  if (!parsed.success) {
    log("suggest_transfer_cost", { ...fields, outcome: "invalid" });
    return null;
  }
  try {
    const client: Client = await createClient();
    const { ledger, truncated } = await ledgerFor(client, parsed.data.input);
    if (truncated) throw new LedgerReadError("movements", "truncated");
    const cost = suggestedTransferCost(ledger, {
      input: parsed.data.input,
      operationId: parsed.data.operationId,
    });
    log("suggest_transfer_cost", { ...fields, outcome: "ok" });
    return cost;
  } catch (error) {
    log("suggest_transfer_cost", { ...fields, outcome: "failed" }, error);
    return null;
  }
}

const quoteQuerySchema = z
  .object({
    symbol: z.string().regex(/^[A-Z0-9]{1,15}$/),
    currency: z.enum(Constants.public.Enums.currency),
    date: z.iso.date(),
  })
  .strict();

// An instrument's price on a date in a currency, from the feeds or the
// user's manual price: what a yield suggests as each unit's value.
export async function quoteOnDate(query: unknown): Promise<string | null> {
  const claims = await getSessionClaims();
  const fields = {
    requestId: await currentRequestId(),
    userId: claims.sub,
    started: performance.now(),
  };
  const parsed = quoteQuerySchema.safeParse(query);
  if (!parsed.success || parsed.data.date > buenosAiresDate(new Date())) {
    log("quote_on", { ...fields, outcome: "invalid" });
    return null;
  }
  const { symbol, date } = parsed.data;
  try {
    const client: Client = await createClient();
    const [quotes, manual] = await Promise.all([
      createQuoteReader(client).read({
        from: addDays(date, -QUOTE_CARRY_DAYS),
        to: date,
        fxKinds: [],
        symbols: [symbol],
      }),
      client
        .from("manual_prices")
        .select("symbol, price_date, price:price::text, currency")
        .eq("symbol", symbol)
        .gte("price_date", addDays(date, -QUOTE_CARRY_DAYS))
        .lte("price_date", date),
    ]);
    if (classifyPostgrestResult(manual, 200) || !manual.data) {
      throw new LedgerReadError("manual_prices", "no_data");
    }
    const price = priceOn(
      {
        quotes,
        manualPrices: manual.data as unknown as ManualPrice[],
        manualRates: [],
      },
      parsed.data,
    );
    log("quote_on", { ...fields, outcome: "ok" });
    return price;
  } catch (error) {
    log("quote_on", { ...fields, outcome: "failed" }, error);
    return null;
  }
}

// A manual price, replacing the one the user stated for that instrument and
// day.
export async function setManualPrice(input: unknown): Promise<PriceResult> {
  const claims = await getSessionClaims();
  const fields = {
    requestId: await currentRequestId(),
    userId: claims.sub,
    started: performance.now(),
  };
  const parsed = manualPriceSchema.safeParse(input);
  if (!parsed.success) {
    log("set_manual_price", { ...fields, outcome: "invalid" });
    return { ok: false, code: "invalid" };
  }
  const admitted = admitManualPrice(parsed.data, buenosAiresDate(new Date()));
  if (!admitted.ok) {
    log("set_manual_price", { ...fields, outcome: admitted.code });
    return admitted;
  }
  const { symbol, price_date, price, currency } = parsed.data;
  const client: Client = await createClient();
  // Amounts stay decimal strings; the casts are only for the generated types.
  const inserted = await client.from("manual_prices").insert({
    symbol,
    price_date,
    price: price as unknown as number,
    currency,
  });
  let response = inserted;
  if (inserted.error?.code === "23505") {
    response = await client
      .from("manual_prices")
      .update({ price: price as unknown as number, currency })
      .eq("symbol", symbol)
      .eq("price_date", price_date);
  }
  const failure = classifyPostgrestResult(response, [201, 204]);
  log(
    "set_manual_price",
    { ...fields, outcome: failure ? "failed" : "ok" },
    failure ? response.error : undefined,
  );
  revalidatePath("/assets", "layout");
  return failure ? { ok: false, code: "failed" } : { ok: true };
}

export async function deleteManualPrice(
  symbol: unknown,
  date: unknown,
): Promise<PriceResult> {
  const claims = await getSessionClaims();
  const fields = {
    requestId: await currentRequestId(),
    userId: claims.sub,
    started: performance.now(),
  };
  const key = z
    .object({
      symbol: z.string().regex(/^[A-Z0-9]{1,15}$/),
      date: z.iso.date(),
    })
    .safeParse({ symbol, date });
  if (!key.success) {
    log("delete_manual_price", { ...fields, outcome: "invalid" });
    return { ok: false, code: "invalid" };
  }
  const client: Client = await createClient();
  const response = await client
    .from("manual_prices")
    .delete()
    .eq("symbol", key.data.symbol)
    .eq("price_date", key.data.date)
    .select("id");
  const failure = classifyPostgrestResult(response, 200);
  const outcome = failure
    ? "failed"
    : (response.data ?? []).length === 1
      ? "ok"
      : "invalid";
  log(
    "delete_manual_price",
    { ...fields, outcome },
    failure ? response.error : undefined,
  );
  revalidatePath("/assets", "layout");
  return outcome === "ok"
    ? { ok: true }
    : { ok: false, code: outcome === "failed" ? "failed" : "invalid" };
}

// An instrument holding comes in through an opening balance at today's
// price, so its units are what its movements leave, as everywhere else.
// Without a price today it is refused: the page asks for an opening balance
// with its price instead.
export async function createInstrumentHolding(
  input: unknown,
): Promise<WriteResult> {
  const claims = await getSessionClaims();
  const fields = {
    requestId: await currentRequestId(),
    userId: claims.sub,
    started: performance.now(),
  };
  const action = "create_instrument_holding";
  const parsed = holdingInsertSchema.safeParse(input);
  if (!parsed.success || parsed.data.asset_class !== "instrument") {
    log(action, { ...fields, outcome: "invalid" });
    return { ok: false, code: "invalid" };
  }
  const holding = parsed.data;
  let result: WriteResult;
  let failure: unknown;
  try {
    const client: Client = await createClient();
    const today = buenosAiresDate(new Date());
    const quotes = await createQuoteReader(client).read({
      from: addDays(today, -QUOTE_CARRY_DAYS),
      to: today,
      fxKinds: [...UNIT_FX_KINDS],
      symbols: [holding.instrument_symbol],
    });
    const { ledger, truncated, symbolOf } = await readLedger(client, {
      today,
      referenceDollar: await referenceDollarOf(client),
      quotes,
    });
    if (truncated) throw new LedgerReadError("movements", "truncated");
    const id = crypto.randomUUID();
    const written = createHolding(ledger, holding, id);
    if (!written.result.ok) {
      result = written.result;
    } else {
      const response = await client.rpc("write_operation", {
        // A new operation's id is the database's.
        p_operation_id: null as unknown as string,
        p_parts: rpcPartsOf(written.state, `${id}-opening`),
        p_expected: expectedRevisions(
          ledger.revisions,
          symbolOf,
          new Set([holding.instrument_symbol]),
        ),
      });
      if (classifyPostgrestResult(response, 200)) {
        const refusal = rpcFailure(response.error ?? {});
        const code =
          refusal === "not_found" ||
          refusal === "portfolio_archived" ||
          refusal === "source_connection_archived"
            ? refusal
            : "failed";
        result = { ok: false, code };
        if (code === "failed") failure = response.error;
      } else {
        const stored = await client
          .from("holdings")
          .select("id")
          .eq("user_id", claims.sub)
          .eq("source_connection_id", holding.source_connection_id)
          .eq("portfolio_id", holding.portfolio_id)
          .eq("instrument_symbol", holding.instrument_symbol)
          .is("archived_at", null)
          .limit(1);
        const holdingId = stored.data?.[0]?.id;
        if (classifyPostgrestResult(stored, 200) || !holdingId) {
          throw stored.error ?? new Error("holding not found after write");
        }
        result = { ok: true, id: holdingId };
      }
    }
  } catch (error) {
    result = { ok: false, code: "failed" };
    failure = error;
  }
  log(action, { ...fields, outcome: result.ok ? "ok" : result.code }, failure);
  if (result.ok) await refreshGainAlerts(fields.userId);
  if (result.ok || result.code !== "invalid")
    revalidatePath("/assets", "layout");
  return result;
}

// A holding and, through the foreign key, every movement it has; an operation
// it shared keeps its other portfolios' parts. One with a transfer is refused,
// since the transfer's other side would be left alone.
export async function deleteHoldingRow(
  id: unknown,
): Promise<HoldingDeleteResult> {
  const claims = await getSessionClaims();
  const fields = {
    requestId: await currentRequestId(),
    userId: claims.sub,
    started: performance.now(),
  };
  const parsed = z.uuid().safeParse(id);
  if (!parsed.success) {
    log("delete_holding", { ...fields, outcome: "invalid" });
    return { ok: false, code: "invalid" };
  }
  const client: Client = await createClient();
  const transfers = await client
    .from("movements")
    .select("id")
    .eq("holding_id", parsed.data)
    .eq("kind", "transfer")
    .limit(1);
  let result: HoldingDeleteResult;
  let failure: unknown;
  if (classifyPostgrestResult(transfers, 200) || !transfers.data) {
    result = { ok: false, code: "failed" };
    failure = transfers.error;
  } else if (transfers.data.length > 0) {
    result = { ok: false, code: "holding_has_transfers" };
  } else {
    const response = await client
      .from("holdings")
      .delete()
      .eq("id", parsed.data)
      .select("id");
    const refused = classifyPostgrestResult(response, 200);
    // A transfer that arrived after the check is refused by the database.
    if (refused && response.error?.hint === "holding_has_transfers") {
      result = { ok: false, code: "holding_has_transfers" };
    } else if (refused) {
      result = { ok: false, code: "failed" };
      failure = response.error;
    } else {
      result =
        (response.data ?? []).length === 1
          ? { ok: true, id: parsed.data }
          : { ok: false, code: "not_found" };
    }
  }
  log(
    "delete_holding",
    { ...fields, outcome: result.ok ? "ok" : result.code },
    failure,
  );
  if (result.ok) await refreshGainAlerts(fields.userId);
  // Anything but a malformed request may mean the page is out of date.
  if (result.ok || result.code !== "invalid")
    revalidatePath("/assets", "layout");
  return result;
}
