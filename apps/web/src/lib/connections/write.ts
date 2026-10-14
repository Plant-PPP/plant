import "server-only";
import { inngestJobRunner } from "@plant/jobs";
import { buenosAiresDate, type Database } from "@plant/shared";
import {
  BINANCE_BASE_URL,
  binanceSource,
  type ExchangeAdapters,
  exchangeCredentialsSchema,
  exchangeProviderSchema,
  SourceError,
} from "@plant/sources";
import type { SupabaseClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getSessionClaims } from "@/lib/auth/session-claims";
import type {
  ApiKeyView,
  ConnectCode,
  ConnectResult,
  DisconnectResult,
  SyncCode,
  SyncResult,
} from "@/lib/connections/api-key";
import { seal, sealContext, secretsKey } from "@/lib/connections/secret-box";
import { serverLog } from "@/lib/log/server-log";
import { REQUEST_ID_FIELD } from "@/lib/request-id";
import { currentRequestId } from "@/lib/request-id-server";
import { classifyPostgrestResult } from "@/lib/supabase/postgrest-write";
import { createClient } from "@/lib/supabase/server";

type Client = SupabaseClient<Database>;

const EVENT = "connections.api_key";

const connectSchema = exchangeCredentialsSchema
  .extend({ accountId: z.uuid(), provider: exchangeProviderSchema })
  .strict();

const exchanges: ExchangeAdapters = {
  binance: () => binanceSource({ baseUrl: BINANCE_BASE_URL }),
};

type Line = {
  step: "connect" | "disconnect" | "sync";
  userId: string;
  requestId: string | undefined;
  started: number;
};

function log(
  { step, userId, requestId, started }: Line,
  outcome: ConnectCode | SyncCode | "ok",
  failure?: unknown,
) {
  const line = {
    [REQUEST_ID_FIELD]: requestId,
    "enduser.id": userId,
    "plant.connection.step": step,
    "plant.connection.duration_ms": Math.round(performance.now() - started),
    "plant.outcome": outcome,
  };
  if (outcome === "failed" || outcome === "unconfigured") {
    serverLog.error(EVENT, line, failure);
  } else if (outcome === "ok") serverLog.info(EVENT, line);
  else serverLog.warn(EVENT, line);
}

async function line(step: Line["step"]): Promise<Line> {
  const claims = await getSessionClaims();
  return {
    step,
    userId: claims.sub,
    requestId: await currentRequestId(),
    started: performance.now(),
  };
}

const REFUSALS: Partial<Record<string, ConnectCode>> = {
  connection_rejected: "rejected",
  connection_not_read_only: "not_read_only",
  extraction_failed: "unavailable",
};

async function accountOpen(client: Client, id: string): Promise<boolean> {
  const result = await client
    .from("source_connections")
    .select("id")
    .eq("id", id)
    .is("archived_at", null);
  if (classifyPostgrestResult(result, 200) || !result.data) {
    throw new Error("account read failed");
  }
  return result.data.length === 1;
}

// The account's key as its page shows it, or null when it holds none. Only
// the columns authenticated may read: never the sealed key.
export async function readApiKey(
  client: Client,
  accountId: string,
): Promise<ApiKeyView | null> {
  const result = await client
    .from("account_api_keys")
    .select("provider, key_hint, created_at")
    .eq("source_connection_id", accountId)
    .limit(1);
  if (classifyPostgrestResult(result, 200) || !result.data) {
    throw new Error("account key read failed");
  }
  const [row] = result.data;
  if (!row) return null;
  const provider = exchangeProviderSchema.parse(row.provider);
  return {
    provider,
    keyHint: row.key_hint,
    connectedOn: buenosAiresDate(new Date(row.created_at)),
  };
}

// Connects an exchange's read-only key to one of the user's open accounts,
// in place of any it held. The exchange is asked first whether the key only
// reads; then the key and its secret are sealed under the server key, bound
// to the user, the account and the exchange, and stored. Neither is logged
// nor sent back.
export async function connectApiKey(
  input: unknown,
  adapters: ExchangeAdapters = exchanges,
): Promise<ConnectResult> {
  const current = await line("connect");
  const parsed = connectSchema.safeParse(input);
  if (!parsed.success) {
    log(current, "invalid");
    return { ok: false, code: "invalid" };
  }
  const { accountId, provider, apiKey, apiSecret } = parsed.data;
  const key = secretsKey();
  if (!key) {
    log(current, "unconfigured");
    return { ok: false, code: "unconfigured" };
  }
  try {
    const client: Client = await createClient();
    if (!(await accountOpen(client, accountId))) {
      log(current, "not_found");
      return { ok: false, code: "not_found" };
    }
    try {
      await adapters[provider]().checkReadOnly({ apiKey, apiSecret });
    } catch (error) {
      const code =
        error instanceof SourceError ? REFUSALS[error.code] : undefined;
      if (!code) throw error;
      log(current, code);
      return { ok: false, code };
    }
    const sealed = seal(
      JSON.stringify({ apiKey, apiSecret }),
      sealContext(current.userId, accountId, provider),
      key,
    );
    const removed = await client
      .from("account_api_keys")
      .delete()
      .eq("user_id", current.userId)
      .eq("source_connection_id", accountId);
    if (classifyPostgrestResult(removed, 204)) {
      throw new Error("earlier key not removed");
    }
    const added = await client.from("account_api_keys").insert({
      source_connection_id: accountId,
      provider,
      key_hint: apiKey.slice(-4),
      secret_ciphertext: sealed,
    });
    const refused = classifyPostgrestResult(added, 201);
    if (refused?.code === "23503") {
      log(current, "not_found");
      return { ok: false, code: "not_found" };
    }
    if (refused) throw new Error(`key not stored: ${refused.code}`);
    log(current, "ok");
    revalidatePath(`/accounts/${accountId}`);
    return { ok: true };
  } catch (error) {
    log(current, "failed", error);
    return { ok: false, code: "failed" };
  }
}

// Removes the account's key. Its syncs, and what they confirmed, stay.
export async function disconnectApiKey(
  accountId: unknown,
): Promise<DisconnectResult> {
  const current = await line("disconnect");
  const parsed = z.uuid().safeParse(accountId);
  if (!parsed.success) {
    log(current, "invalid");
    return { ok: false };
  }
  const client: Client = await createClient();
  const removed = await client
    .from("account_api_keys")
    .delete()
    .eq("user_id", current.userId)
    .eq("source_connection_id", parsed.data);
  if (classifyPostgrestResult(removed, 204)) {
    log(current, "failed", removed.error);
    return { ok: false };
  }
  log(current, "ok");
  revalidatePath(`/accounts/${parsed.data}`);
  return { ok: true };
}

// Starts a sync of the account: an import of its balances that the import
// job reads with the account's key and leaves ready to review in Cargar. The
// database refuses an account with no key and one already syncing.
export async function syncAccount(accountId: unknown): Promise<SyncResult> {
  const current = await line("sync");
  const parsed = z.uuid().safeParse(accountId);
  if (!parsed.success) {
    log(current, "invalid");
    return { ok: false, code: "invalid" };
  }
  try {
    const client: Client = await createClient();
    const keys = await client
      .from("account_api_keys")
      .select("provider")
      .eq("source_connection_id", parsed.data)
      .limit(1);
    if (classifyPostgrestResult(keys, 200)) throw new Error("key read failed");
    const provider = exchangeProviderSchema.safeParse(keys.data?.[0]?.provider);
    if (!provider.success) {
      log(current, "not_connected");
      return { ok: false, code: "not_connected" };
    }
    const started = await client
      .from("imports")
      .insert({ source_connection_id: parsed.data, provider: provider.data })
      .select("id");
    const refused = classifyPostgrestResult(started, 201);
    if (refused?.code === "PT404") {
      log(current, "not_connected");
      return { ok: false, code: "not_connected" };
    }
    if (refused?.code === "PT409") {
      log(current, "in_progress");
      return { ok: false, code: "in_progress" };
    }
    if (refused || started.data?.length !== 1) {
      throw new Error(`sync not started: ${refused?.code ?? "no_row"}`);
    }
    const importId = started.data[0]!.id;
    // A failure to send leaves the import queued, as an upload's does.
    try {
      await inngestJobRunner().startImport({
        importId,
        userId: current.userId,
      });
    } catch (error) {
      serverLog.error(
        EVENT,
        { "enduser.id": current.userId, "plant.connection.step": "job" },
        error,
      );
    }
    log(current, "ok");
    revalidatePath("/import");
    return { ok: true, importId };
  } catch (error) {
    log(current, "failed", error);
    return { ok: false, code: "failed" };
  }
}
