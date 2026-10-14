import "server-only";
import { inngestJobRunner } from "@plant/jobs";
import { BUENOS_AIRES_TZ, buenosAiresDate, type Database } from "@plant/shared";
import {
  type ConnectionAdapters,
  type ConnectionProvider,
  connectionAdapters,
  connectionDraftSchema,
  connectionProviderSchema,
  SourceError,
} from "@plant/sources";
import type { SupabaseClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getSessionClaims } from "@/lib/auth/session-claims";
import {
  type ApiKeyView,
  type ConnectCode,
  type ConnectResult,
  type DisconnectResult,
  keyHintOf,
  type LastSync,
  needsConfirmation,
  providerOf,
  type SyncCode,
  type SyncResult,
} from "@/lib/connections/api-key";
import { serverLog } from "@/lib/log/server-log";
import { REQUEST_ID_FIELD } from "@/lib/request-id";
import { currentRequestId } from "@/lib/request-id-server";
import { classifyPostgrestResult } from "@/lib/supabase/postgrest-write";
import { createClient } from "@/lib/supabase/server";

type Client = SupabaseClient<Database>;

const EVENT = "connections.api_key";

// The most bytes the database takes for an account's credentials, as the
// text of their jsonb.
export const CREDENTIALS_MAX_BYTES = 4096;

// The bytes of credentials as Postgres prints their jsonb: JSON with a space
// after each colon and comma.
export const credentialsBytes = (credentials: Record<string, string>) => {
  const entries = Object.keys(credentials).length;
  return (
    new TextEncoder().encode(JSON.stringify(credentials)).length +
    Math.max(0, 2 * entries - 1)
  );
};

// The credentials are checked by the provider's own schema; this only bounds
// their shape: a value fits a private key in PEM, and the whole object fits
// what the database takes, so an oversize one is invalid rather than a
// failed write.
const connectSchema = z
  .object({
    accountId: z.uuid(),
    provider: connectionProviderSchema,
    credentials: z
      .record(z.string().max(40), z.string().max(CREDENTIALS_MAX_BYTES))
      .refine(
        (credentials) => credentialsBytes(credentials) <= CREDENTIALS_MAX_BYTES,
      ),
    confirmedReadOnly: z.boolean(),
  })
  .strict();

type Line = {
  step: "connect" | "disconnect" | "sync";
  userId: string;
  requestId: string | undefined;
  started: number;
  provider?: ConnectionProvider;
};

function log(
  { step, userId, requestId, started, provider }: Line,
  outcome: ConnectCode | SyncCode | "ok",
  failure?: unknown,
) {
  const line = {
    [REQUEST_ID_FIELD]: requestId,
    "enduser.id": userId,
    "plant.connection.step": step,
    "plant.connection.provider": provider,
    "plant.connection.duration_ms": Math.round(performance.now() - started),
    "plant.outcome": outcome,
  };
  if (outcome === "failed") serverLog.error(EVENT, line, failure);
  else if (outcome === "ok") serverLog.info(EVENT, line);
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

// The institution of one of the user's open accounts, or null.
async function openAccountInstitution(
  client: Client,
  id: string,
): Promise<string | null> {
  const result = await client
    .from("source_connections")
    .select("institution")
    .eq("id", id)
    .is("archived_at", null);
  if (classifyPostgrestResult(result, 200) || !result.data) {
    throw new Error("account read failed");
  }
  return result.data[0]?.institution ?? null;
}

// Stores the credentials in place of the account's: the database moves them
// into Vault (a new secret, or the key's own one replaced) and keeps none in
// the row. One write, so a failure leaves the credentials it held. An
// insert that lost a race with another connect replaces the row that won.
async function storeKey(
  client: Client,
  userId: string,
  row: {
    source_connection_id: string;
    provider: ConnectionProvider;
    key_hint: string;
    credentials: Record<string, string>;
  },
): Promise<"ok" | "not_found"> {
  const replace = async () => {
    const { source_connection_id, ...fields } = row;
    const updated = await client
      .from("account_api_keys")
      .update(fields)
      .eq("user_id", userId)
      .eq("source_connection_id", source_connection_id)
      .select("id");
    const refused = classifyPostgrestResult(updated, 200);
    if (refused?.code === "42501") return "not_found";
    if (refused) throw new Error(`key not replaced: ${refused.code}`);
    return (updated.data ?? []).length === 1;
  };
  const replaced = await replace();
  if (replaced === "not_found") return "not_found";
  if (replaced) return "ok";
  const added = await client.from("account_api_keys").insert(row);
  const refused = classifyPostgrestResult(added, 201);
  // The account is not an open one of the user's (the trigger, or the
  // foreign key).
  if (refused?.code === "42501" || refused?.code === "23503") {
    return "not_found";
  }
  if (refused?.code === "23505" && (await replace()) === true) return "ok";
  if (refused) throw new Error(`key not stored: ${refused.code}`);
  return "ok";
}

// The account's connection as its page shows it, or null when it holds
// none. Only the columns authenticated may read: never the credentials.
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
  const provider = connectionProviderSchema.safeParse(row?.provider);
  if (!row || !provider.success) return null;
  return {
    provider: provider.data,
    keyHint: row.key_hint,
    connectedOn: buenosAiresDate(new Date(row.created_at)),
    lastSync: await readLastSync(client, accountId),
  };
}

const BUENOS_AIRES_TIME = new Intl.DateTimeFormat("es-AR", {
  timeZone: BUENOS_AIRES_TZ,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

// The account's latest sync, or null when it never synced.
async function readLastSync(
  client: Client,
  accountId: string,
): Promise<LastSync | null> {
  const result = await client
    .from("imports")
    .select("status, failure, updated_at")
    .eq("source_connection_id", accountId)
    .order("created_at", { ascending: false })
    .limit(1);
  if (classifyPostgrestResult(result, 200) || !result.data) {
    throw new Error("last sync read failed");
  }
  const [sync] = result.data;
  if (!sync) return null;
  const changed = new Date(sync.updated_at);
  return {
    status: sync.status,
    failure: sync.failure,
    on: buenosAiresDate(changed),
    at: BUENOS_AIRES_TIME.format(changed),
  };
}

// Connects a provider's credentials to one of the user's open accounts at
// that provider, in place of any it held. The provider is asked first
// whether they work (and only read, where it says); where it does not say,
// the user confirms they only read. Then the database keeps them in Vault.
// They are never logged nor sent back.
export async function connectApiKey(
  input: unknown,
  adapters: ConnectionAdapters = connectionAdapters(),
): Promise<ConnectResult> {
  const current = await line("connect");
  const parsed = connectSchema.safeParse(input);
  if (!parsed.success) {
    log(current, "invalid");
    return { ok: false, code: "invalid" };
  }
  const { accountId, provider, confirmedReadOnly } = parsed.data;
  current.provider = provider;
  const adapter = adapters[provider]();
  const credentials = adapter.parse(parsed.data.credentials);
  if (!credentials) {
    log(current, "invalid");
    return { ok: false, code: "invalid" };
  }
  if (needsConfirmation(adapter.readOnly) && !confirmedReadOnly) {
    log(current, "unconfirmed");
    return { ok: false, code: "unconfirmed" };
  }
  try {
    const client: Client = await createClient();
    const institution = await openAccountInstitution(client, accountId);
    if (institution === null) {
      log(current, "not_found");
      return { ok: false, code: "not_found" };
    }
    if (providerOf(institution) !== provider) {
      log(current, "unsupported");
      return { ok: false, code: "unsupported" };
    }
    try {
      await adapter.check(credentials);
    } catch (error) {
      const code =
        error instanceof SourceError ? REFUSALS[error.code] : undefined;
      if (!code) throw error;
      log(current, code);
      return { ok: false, code };
    }
    const stored = await storeKey(client, current.userId, {
      source_connection_id: accountId,
      provider,
      key_hint: keyHintOf(credentials[adapter.hintField] ?? ""),
      credentials,
    });
    if (stored === "not_found") {
      log(current, "not_found");
      return { ok: false, code: "not_found" };
    }
    log(current, "ok");
    revalidatePath(`/accounts/${accountId}`);
    return { ok: true };
  } catch (error) {
    log(current, "failed", error);
    return { ok: false, code: "failed" };
  }
}

// Removes the account's connection and, through the database, its Vault
// secret. Its syncs, and what they confirmed, stay.
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

// Sends the job for a sync import. A failure to send leaves it queued, which
// the next "Sincronizar" sends again as a retry: a job that ended without
// settling it (its failure handler could not write) leaves it queued too, and
// the first event's id is spent.
async function startJob(
  userId: string,
  importId: string,
  retry?: string,
): Promise<void> {
  try {
    await inngestJobRunner().startImport({ importId, userId, retry });
  } catch (error) {
    serverLog.error(
      EVENT,
      { "enduser.id": userId, "plant.connection.step": "job" },
      error,
    );
  }
}

// The days a sync of operations reads; a null end leaves it open.
const periodSchema = z
  .object({ from: z.iso.date().nullable(), to: z.iso.date().nullable() })
  .strict()
  .refine(
    ({ from, to }) =>
      (from === null || from >= "2000-01-01") &&
      (from === null || to === null || from <= to),
  );

// The account's sync still in flight, if any: queued (its job may never have
// started) or being read.
async function syncInFlight(
  client: Client,
  accountId: string,
): Promise<{ id: string; status: "queued" | "reading" } | null> {
  const result = await client
    .from("imports")
    .select("id, status")
    .eq("source_connection_id", accountId)
    .in("status", ["queued", "reading"])
    .limit(1);
  if (classifyPostgrestResult(result, 200)) {
    throw new Error("sync in flight not read");
  }
  const [row] = result.data ?? [];
  return row && (row.status === "queued" || row.status === "reading")
    ? { id: row.id, status: row.status }
    : null;
}

// Starts a sync of the account: an import of its holdings or its
// operations that the import job reads with the account's credentials and
// leaves ready to review in Cargar. The database refuses an account with no
// key and one already syncing; a sync still queued is started again
// instead, so a lost job never locks the account. A sync of operations reads
// only the days of `period`, when one is given.
export async function syncAccount(
  accountId: unknown,
  draft: unknown = "holdings",
  period: unknown = null,
  adapters: ConnectionAdapters = connectionAdapters(),
): Promise<SyncResult> {
  const current = await line("sync");
  const parsed = z
    .object({
      accountId: z.uuid(),
      draft: connectionDraftSchema,
      period: periodSchema.nullable(),
    })
    .refine((input) => input.period === null || input.draft === "operations")
    .safeParse({ accountId, draft, period });
  if (!parsed.success) {
    log(current, "invalid");
    return { ok: false, code: "invalid" };
  }
  const { accountId: id, draft: kind } = parsed.data;
  try {
    const client: Client = await createClient();
    const keys = await client
      .from("account_api_keys")
      .select("provider")
      .eq("source_connection_id", id)
      .limit(1);
    if (classifyPostgrestResult(keys, 200)) throw new Error("key read failed");
    const provider = connectionProviderSchema.safeParse(
      keys.data?.[0]?.provider,
    );
    if (!provider.success) {
      log(current, "not_connected");
      return { ok: false, code: "not_connected" };
    }
    current.provider = provider.data;
    if (!adapters[provider.data]().drafts.includes(kind)) {
      log(current, "invalid");
      return { ok: false, code: "invalid" };
    }
    const resume = async (): Promise<SyncResult | null> => {
      const flying = await syncInFlight(client, id);
      if (!flying) return null;
      if (flying.status === "reading") {
        log(current, "in_progress");
        return { ok: false, code: "in_progress" };
      }
      await startJob(current.userId, flying.id, Date.now().toString(36));
      log(current, "ok");
      return { ok: true, importId: flying.id };
    };
    const resumed = await resume();
    if (resumed) return resumed;
    const started = await client
      .from("imports")
      .insert({
        source_connection_id: id,
        provider: provider.data,
        sync_draft: kind,
        sync_from: parsed.data.period?.from ?? null,
        sync_to: parsed.data.period?.to ?? null,
      })
      .select("id");
    const refused = classifyPostgrestResult(started, 201);
    if (refused?.code === "PT404") {
      log(current, "not_connected");
      return { ok: false, code: "not_connected" };
    }
    if (refused?.code === "PT409") {
      // Another sync started in between.
      const raced = await resume();
      if (raced) return raced;
      log(current, "in_progress");
      return { ok: false, code: "in_progress" };
    }
    if (refused || started.data?.length !== 1) {
      throw new Error(`sync not started: ${refused?.code ?? "no_row"}`);
    }
    const importId = started.data[0]!.id;
    await startJob(current.userId, importId);
    log(current, "ok");
    revalidatePath("/import");
    return { ok: true, importId };
  } catch (error) {
    log(current, "failed", error);
    return { ok: false, code: "failed" };
  }
}
