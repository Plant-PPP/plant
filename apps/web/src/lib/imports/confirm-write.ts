import "server-only";
import { buenosAiresDate, type Database } from "@plant/shared";
import type { SupabaseClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getSessionClaims } from "@/lib/auth/session-claims";
import type { MovementResult } from "@/lib/holdings/movements-input";
import { type ImportToWrite, writeImport } from "@/lib/imports/confirm";
import { ImportsReadError } from "@/lib/imports/read";
import type { ImportRow } from "@/lib/imports/review";
import { LedgerReadError } from "@/lib/ledger/read";
import {
  expectedRevisions,
  operationSymbols,
  rpcPartsOf,
} from "@/lib/ledger/rpc-parts";
import { ledgerFor, rpcFailure } from "@/lib/ledger/write";
import { serverLog } from "@/lib/log/server-log";
import { REQUEST_ID_FIELD } from "@/lib/request-id";
import { currentRequestId } from "@/lib/request-id-server";
import { classifyPostgrestResult } from "@/lib/supabase/postgrest-write";
import { createClient } from "@/lib/supabase/server";

type Client = SupabaseClient<Database>;

const EVENT = "imports.confirm";

// The most rows one review confirms; the draft holds at most this many.
const REVIEW_ROW_LIMIT = 500;

const importSchema = z.object({
  id: z.string(),
  status: z.enum(["queued", "reading", "ready", "failed", "confirmed"]),
  document_date: z.string().nullable(),
  document: z.object({
    source_connection_id: z.string(),
    file_name: z.string(),
  }),
});

// The user's import, when it is ready to confirm: its account, the date its
// holdings are at (today when the document printed none, never a later
// day), and its file's name.
async function readyImport(
  client: Client,
  id: string,
  today: string,
): Promise<ImportToWrite | null> {
  const result = await client
    .from("imports")
    .select(
      "id, status, document_date, " +
        "document:uploaded_documents!imports_user_id_document_id_fkey(source_connection_id, file_name)",
    )
    .eq("id", id)
    .limit(1);
  const failure = classifyPostgrestResult(result, 200);
  if (failure || !result.data) {
    throw new ImportsReadError(failure?.code ?? "no_data");
  }
  const [row] = result.data as unknown[];
  if (row === undefined) return null;
  const found = importSchema.parse(row);
  if (found.status !== "ready") return null;
  const printed = found.document_date;
  return {
    id: found.id,
    accountId: found.document.source_connection_id,
    date: printed !== null && printed <= today ? printed : today,
    fileName: found.document.file_name,
  };
}

// Writes the reviewed rows of a ready import into its account and marks it
// confirmed, all in confirm_import's one transaction: admitted by the same
// code the prototype runs against the user's ledger, then each operation
// written with the revisions read.
export async function confirmImportRows(
  importId: unknown,
  rows: unknown,
): Promise<MovementResult> {
  // Outside any try: its redirect to /login or /auth/mfa must propagate.
  const claims = await getSessionClaims();
  const started = performance.now();
  const requestId = await currentRequestId();

  let result: MovementResult;
  let failure: unknown;
  let operations = 0;
  const id = z.uuid().safeParse(importId);
  const reviewed = z
    .array(z.record(z.string(), z.unknown()))
    .max(REVIEW_ROW_LIMIT)
    .safeParse(rows);
  if (!id.success || !reviewed.success) {
    result = { ok: false, code: "invalid" };
  } else {
    try {
      const client: Client = await createClient();
      const today = buenosAiresDate(new Date());
      const item = await readyImport(client, id.data, today);
      if (!item) {
        result = { ok: false, code: "not_found" };
      } else {
        const { ledger, truncated, symbolOf } = await ledgerFor(client, {
          date: item.date,
        });
        if (truncated) throw new LedgerReadError("movements", "truncated");
        const written = writeImport(
          ledger,
          item,
          reviewed.data as unknown as ImportRow[],
          () => crypto.randomUUID(),
        );
        if (!written.result.ok) {
          result = written.result;
        } else {
          operations = written.operations.length;
          const response = await client.rpc("confirm_import", {
            p_import_id: item.id,
            p_operations: written.operations.map((operation) => ({
              parts: rpcPartsOf(written.state, operation),
              expected: expectedRevisions(
                ledger.revisions,
                symbolOf,
                operationSymbols(written.state, operation),
              ),
            })),
          });
          if (classifyPostgrestResult(response, 200)) {
            result = { ok: false, code: rpcFailure(response.error ?? {}) };
            if (result.code === "failed") failure = response.error;
          } else {
            result = { ok: true, id: item.id };
          }
        }
      }
    } catch (error) {
      result = { ok: false, code: "failed" };
      failure = error;
    }
  }

  const outcome = result.ok ? "ok" : result.code;
  const line = {
    [REQUEST_ID_FIELD]: requestId,
    "enduser.id": claims.sub,
    "plant.import.operation_count": operations,
    "plant.import.duration_ms": Math.round(performance.now() - started),
    "plant.outcome": outcome,
  };
  if (outcome === "failed") serverLog.error(EVENT, line, failure);
  else if (outcome === "ok") serverLog.info(EVENT, line);
  else serverLog.warn(EVENT, line);
  if (result.ok || outcome === "failed") {
    revalidatePath("/import", "layout");
    revalidatePath("/assets", "layout");
  }
  return result;
}
