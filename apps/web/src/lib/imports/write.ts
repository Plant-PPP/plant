import "server-only";
import { inngestJobRunner } from "@plant/jobs";
import { buenosAiresDate, type Database } from "@plant/shared";
import type { SupabaseClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getSessionClaims } from "@/lib/auth/session-claims";
import {
  bytesMatch,
  cleanFileName,
  UPLOAD_BUCKET,
  UPLOAD_MAX_BYTES,
  uploadPath,
  uploadPathProblem,
  type UploadType,
  uploadTypeOf,
} from "@/lib/imports/upload";
import { IMPORTS_PER_MONTH } from "@/lib/imports/review";
import { serverLog } from "@/lib/log/server-log";
import { CONSENT_VERSION } from "@/lib/onboarding/steps";
import { REQUEST_ID_FIELD } from "@/lib/request-id";
import { currentRequestId } from "@/lib/request-id-server";
import { classifyPostgrestResult } from "@/lib/supabase/postgrest-write";
import { createClient } from "@/lib/supabase/server";

type Client = SupabaseClient<Database>;

const EVENT = "imports.upload";

// Why an upload was refused: input that does not parse, a type Cargar does
// not take or bytes that are not of the type the name says, a file too big
// or empty, terms not accepted, an account the user does not have open, the
// same file already uploaded to that account, the month's imports used up, or
// a failure.
export type UploadCode =
  | "invalid"
  | "type"
  | "size"
  | "terms"
  | "not_found"
  | "duplicate"
  | "quota"
  | "failed";

export type StartResult =
  | {
      ok: true;
      uploadId: string;
      path: string;
      token: string;
      // The type to send the file as: the one its name says, whatever the
      // browser calls it.
      type: UploadType;
    }
  | { ok: false; code: UploadCode };

export type FinishResult =
  { ok: true; importId: string } | { ok: false; code: UploadCode };

const startSchema = z
  .object({
    fileName: z.string().min(1).max(1024),
    size: z.number().int(),
    accountId: z.uuid(),
  })
  .strict();

const finishSchema = z
  .object({
    uploadId: z.uuid(),
    path: z.string().max(200),
    fileName: z.string().min(1).max(1024),
    accountId: z.uuid(),
  })
  .strict();

type Line = {
  step: "start" | "finish" | "terms" | "job";
  userId: string;
  requestId: string | undefined;
  started: number;
  type?: UploadType | null;
};

function log(
  { step, userId, requestId, started, type }: Line,
  outcome: UploadCode | "ok",
  failure?: unknown,
) {
  const line = {
    [REQUEST_ID_FIELD]: requestId,
    "enduser.id": userId,
    "plant.import.step": step,
    "plant.import.type": type ?? undefined,
    "plant.import.duration_ms": Math.round(performance.now() - started),
    "plant.outcome": outcome,
  };
  if (outcome === "failed") serverLog.error(EVENT, line, failure);
  else if (outcome === "ok") serverLog.info(EVENT, line);
  else serverLog.warn(EVENT, line);
}

// Whether the user accepted the terms in force; the terms row is written
// with the privacy and AI provider ones.
export async function termsAccepted(client: Client): Promise<boolean> {
  const result = await client
    .from("consents")
    .select("version, granted")
    .eq("kind", "terms")
    .order("accepted_at", { ascending: false })
    .limit(1);
  if (classifyPostgrestResult(result, 200) || !result.data) {
    throw new Error("consents read failed");
  }
  const [latest] = result.data;
  return latest?.granted === true && latest.version === CONSENT_VERSION;
}

// Whether the account is one of the user's open ones.
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

// Whether the user has imports left this month. The database checks it again
// when the import is filed.
async function quotaLeft(client: Client): Promise<boolean> {
  const today = buenosAiresDate(new Date());
  const result = await client
    .from("imports")
    .select("id", { count: "exact", head: true })
    .gte("created_at", `${today.slice(0, 7)}-01T00:00:00-03:00`);
  if (classifyPostgrestResult(result, 200) || result.count === null) {
    throw new Error("imports count failed");
  }
  return result.count < IMPORTS_PER_MONTH;
}

// The size and type a file's name and size say, before any byte is sent.
function admitted(
  fileName: string,
  size: number,
):
  | { ok: true; name: string; type: UploadType }
  | { ok: false; code: UploadCode; type: UploadType | null } {
  const name = cleanFileName(fileName);
  const type = uploadTypeOf(fileName);
  if (name === null) return { ok: false, code: "invalid", type };
  if (type === null) return { ok: false, code: "type", type };
  if (size < 1 || size > UPLOAD_MAX_BYTES) {
    return { ok: false, code: "size", type };
  }
  return { ok: true, name, type };
}

// The first half of an upload: checks the file's name and size, the terms and
// the account, and answers a signed URL to put the file at, under the user's
// folder and a new upload's id.
export async function startUpload(input: unknown): Promise<StartResult> {
  // Outside any try: its redirect to /login or /auth/mfa must propagate.
  const claims = await getSessionClaims();
  const line: Line = {
    step: "start",
    userId: claims.sub,
    requestId: await currentRequestId(),
    started: performance.now(),
  };
  const parsed = startSchema.safeParse(input);
  if (!parsed.success) {
    log(line, "invalid");
    return { ok: false, code: "invalid" };
  }
  const { fileName, size, accountId } = parsed.data;
  const file = admitted(fileName, size);
  line.type = file.type;
  if (!file.ok) {
    log(line, file.code);
    return { ok: false, code: file.code };
  }
  try {
    const client: Client = await createClient();
    if (!(await termsAccepted(client))) {
      log(line, "terms");
      return { ok: false, code: "terms" };
    }
    if (!(await accountOpen(client, accountId))) {
      log(line, "not_found");
      return { ok: false, code: "not_found" };
    }
    if (!(await quotaLeft(client))) {
      log(line, "quota");
      return { ok: false, code: "quota" };
    }
    const uploadId = crypto.randomUUID();
    const path = uploadPath(claims.sub, uploadId, crypto.randomUUID());
    const { data, error } = await client.storage
      .from(UPLOAD_BUCKET)
      .createSignedUploadUrl(path);
    if (error || !data) throw error ?? new Error("no signed upload");
    log(line, "ok");
    return { ok: true, uploadId, path, token: data.token, type: file.type };
  } catch (error) {
    log(line, "failed", error);
    return { ok: false, code: "failed" };
  }
}

const hex = (buffer: ArrayBuffer) =>
  [...new Uint8Array(buffer)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

// The second half: reads the file back from Storage, checks its size and its
// first bytes against the type its name says, and files it with a queued
// import. A file refused here, or one the account already has, is removed.
export async function finishUpload(input: unknown): Promise<FinishResult> {
  const claims = await getSessionClaims();
  const line: Line = {
    step: "finish",
    userId: claims.sub,
    requestId: await currentRequestId(),
    started: performance.now(),
  };
  const parsed = finishSchema.safeParse(input);
  if (
    !parsed.success ||
    uploadPathProblem(parsed.data.path, {
      userId: claims.sub,
      uploadId: parsed.data.uploadId,
    }) !== null
  ) {
    log(line, "invalid");
    return { ok: false, code: "invalid" };
  }
  const { path, fileName, accountId } = parsed.data;
  const client: Client = await createClient();
  const bucket = client.storage.from(UPLOAD_BUCKET);
  const refuse = async (code: UploadCode): Promise<FinishResult> => {
    await bucket.remove([path]);
    log(line, code);
    return { ok: false, code };
  };
  try {
    const { data: blob, error } = await bucket.download(path);
    if (error || !blob) {
      log(line, "not_found");
      return { ok: false, code: "not_found" };
    }
    const file = admitted(fileName, blob.size);
    line.type = file.type;
    if (!file.ok) return await refuse(file.code);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (!bytesMatch(file.type, bytes)) return await refuse("type");
    const sha256 = hex(await crypto.subtle.digest("SHA-256", bytes));

    const document = await client
      .from("uploaded_documents")
      .insert({
        source_connection_id: accountId,
        storage_path: path,
        file_name: file.name,
        mime_type: file.type,
        size_bytes: blob.size,
        sha256,
      })
      .select("id");
    const refused = classifyPostgrestResult(document, 201);
    if (refused?.code === "23505") return await refuse("duplicate");
    if (refused?.code === "23503") return await refuse("not_found");
    if (refused || document.data?.length !== 1) {
      throw document.error ?? new Error("document not filed");
    }
    const documentId = document.data[0]!.id;
    const started = await client
      .from("imports")
      .insert({ document_id: documentId })
      .select("id");
    const notStarted = classifyPostgrestResult(started, 201);
    if (notStarted || started.data?.length !== 1) {
      // Without its import the file would only stand in the way of the same
      // file again.
      await client.from("uploaded_documents").delete().eq("id", documentId);
      if (notStarted?.code === "PT429") return await refuse("quota");
      await bucket.remove([path]);
      throw started.error ?? new Error("import not started");
    }
    const importId = started.data[0]!.id;
    log(line, "ok");
    await startJob(
      { ...line, step: "job", started: performance.now() },
      importId,
    );
    revalidatePath("/import");
    return { ok: true, importId };
  } catch (error) {
    log(line, "failed", error);
    return { ok: false, code: "failed" };
  }
}

// Starts reading the import's file. A failure leaves the import queued and is
// logged: the upload itself succeeded.
async function startJob(line: Line, importId: string): Promise<void> {
  try {
    await inngestJobRunner().startImport({ importId, userId: line.userId });
    log(line, "ok");
  } catch (error) {
    log(line, "failed", error);
  }
}

// Accepts the terms, the privacy policy and the AI providers in force.
export async function acceptTerms(): Promise<{ ok: boolean }> {
  const claims = await getSessionClaims();
  const line: Line = {
    step: "terms",
    userId: claims.sub,
    requestId: await currentRequestId(),
    started: performance.now(),
  };
  const client: Client = await createClient();
  const result = await client.from("consents").insert(
    (["terms", "privacy", "ai_providers"] as const).map((kind) => ({
      kind,
      version: CONSENT_VERSION,
      granted: true,
    })),
  );
  if (classifyPostgrestResult(result, 201)) {
    log(line, "failed", result.error);
    return { ok: false };
  }
  log(line, "ok");
  revalidatePath("/import");
  return { ok: true };
}
