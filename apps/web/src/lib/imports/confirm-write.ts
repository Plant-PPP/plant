import "server-only";
import { LIABILITY_LABEL_MAX } from "@plant/core";
import {
  buenosAiresDate,
  Constants,
  currencySchema,
  type Database,
  positiveDecimalSchema,
} from "@plant/shared";
import { DRAFT_DEBT_LIMIT } from "@plant/sources";
import type { SupabaseClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getSessionClaims } from "@/lib/auth/session-claims";
import type { MovementResult } from "@/lib/holdings/movements-input";
import {
  type CashEntry,
  cashEntries,
  reviewedCashSchema,
} from "@/lib/imports/cash";
import { type ImportToWrite, writeImportRouted } from "@/lib/imports/confirm";
import {
  IMPORT_ORIGIN_COLUMNS,
  importOrigin,
  importOriginSchema,
} from "@/lib/imports/origin";
import { ImportsReadError } from "@/lib/imports/read";
import { writeImportOperations } from "@/lib/imports/confirm-operations";
import { withoutLoaded } from "@/lib/imports/operations-loaded";
import type { ImportOperationRow, ImportRow } from "@/lib/imports/review";
import { LedgerReadError } from "@/lib/ledger/read";
import {
  expectedRevisions,
  operationSymbols,
  rpcPartsOf,
} from "@/lib/ledger/rpc-parts";
import {
  ledgerFor,
  ledgerForDates,
  refreshGainAlerts,
  rpcFailure,
} from "@/lib/ledger/write";
import { serverLog } from "@/lib/log/server-log";
import { REQUEST_ID_FIELD } from "@/lib/request-id";
import { currentRequestId } from "@/lib/request-id-server";
import { classifyPostgrestResult } from "@/lib/supabase/postgrest-write";
import { createClient } from "@/lib/supabase/server";

type Client = SupabaseClient<Database>;

const EVENT = "imports.confirm";

// The most rows one review confirms; the draft holds at most this many.
const REVIEW_ROW_LIMIT = 500;

const importSchema = importOriginSchema.extend({
  id: z.string(),
  status: z.enum(Constants.public.Enums.import_status),
  document_date: z.string().nullable(),
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
    .select(`id, status, document_date, ${IMPORT_ORIGIN_COLUMNS}`)
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
  const { accountId, fileName } = importOrigin(found);
  return {
    id: found.id,
    accountId,
    date: printed !== null && printed <= today ? printed : today,
    fileName,
  };
}

type LedgerRead = Awaited<ReturnType<typeof ledgerFor>>;

// Sends the operations written to confirm_import, each with the revisions of
// its instruments as the ledger was read, and then the cash balances: the
// database checks them once, and writes them in turn, all or nothing.
async function sendConfirm(
  client: Client,
  importId: string,
  ledger: LedgerRead["ledger"],
  symbolOf: LedgerRead["symbolOf"],
  written: { state: LedgerRead["ledger"]; operations: string[] },
  cash: readonly CashEntry[] = [],
): Promise<{ result: MovementResult; failure?: unknown }> {
  const response = await client.rpc("confirm_import", {
    p_import_id: importId,
    p_operations: [
      ...written.operations.map((operation) => ({
        parts: rpcPartsOf(written.state, operation),
        expected: expectedRevisions(
          ledger.revisions,
          symbolOf,
          operationSymbols(written.state, operation),
        ),
      })),
      ...cash,
    ],
  });
  if (!classifyPostgrestResult(response, 200)) {
    return { result: { ok: true, id: importId } };
  }
  const code =
    response.error?.hint === "stale"
      ? "stale"
      : rpcFailure(response.error ?? {});
  return {
    result: { ok: false, code },
    ...(code === "failed" && { failure: response.error }),
  };
}

// Writes the reviewed rows of a ready import into its account and marks it
// confirmed, all in confirm_import's one transaction: admitted by the same
// code the prototype runs against the user's ledger, then each operation
// written with the revisions read, and each cash balance against the cash
// the review showed (`heldCash`).
export async function confirmImportRows(
  importId: unknown,
  rows: unknown,
  heldCash: unknown = [],
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
  const cashRead = reviewedCashSchema.safeParse(heldCash);
  if (!id.success || !reviewed.success || !cashRead.success) {
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
        const typed = reviewed.data as unknown as ImportRow[];
        const cash = cashEntries(
          typed,
          item.accountId,
          new Set(ledger.accounts.map((each) => each.id)),
          cashRead.data,
        );
        const written = writeImportRouted(
          ledger,
          item,
          typed.filter((row) => row.assetClass !== "cash"),
          () => crypto.randomUUID(),
        );
        if (!cash.ok) {
          result = { ok: false, code: cash.code };
        } else if (!written.result.ok) {
          result = written.result;
        } else {
          operations = written.operations.length + cash.entries.length;
          ({ result, failure } = await sendConfirm(
            client,
            item.id,
            ledger,
            symbolOf,
            written,
            cash.entries,
          ));
        }
      }
    } catch (error) {
      result = { ok: false, code: "failed" };
      failure = error;
    }
  }

  await logConfirm({
    requestId,
    userId: claims.sub,
    importId: id.success ? id.data : undefined,
    draft: "holdings",
    operations,
    started,
    result,
    failure,
  });
  return result;
}

// One line per confirmation, and the pages it changes revalidated.
async function logConfirm({
  requestId,
  userId,
  importId,
  draft,
  operations,
  started,
  result,
  failure,
}: {
  requestId: string | undefined;
  userId: string;
  importId: string | undefined;
  draft: "holdings" | "operations" | "debts";
  operations: number;
  started: number;
  result: MovementResult;
  failure: unknown;
}) {
  const outcome = result.ok ? "ok" : result.code;
  const line = {
    [REQUEST_ID_FIELD]: requestId,
    "enduser.id": userId,
    "plant.import.id": importId,
    "plant.import.draft": draft,
    "plant.import.operation_count": operations,
    "plant.import.duration_ms": Math.round(performance.now() - started),
    "plant.outcome": outcome,
  };
  if (outcome === "failed") serverLog.error(EVENT, line, failure);
  else if (outcome === "ok") serverLog.info(EVENT, line);
  else serverLog.warn(EVENT, line);
  if (result.ok || outcome === "failed" || outcome === "stale") {
    revalidatePath("/import", "layout");
    revalidatePath(draft === "debts" ? "/debts" : "/assets", "layout");
  }
  if (result.ok && draft !== "debts") await refreshGainAlerts(userId);
}

// Writes the reviewed operations of a ready import into its account and
// marks it confirmed, in confirm_import's one transaction. A refusal names
// the row it stopped at.
export async function confirmImportOperations(
  importId: unknown,
  rows: unknown,
): Promise<MovementResult & { rowId?: string }> {
  // Outside any try: its redirect to /login or /auth/mfa must propagate.
  const claims = await getSessionClaims();
  const started = performance.now();
  const requestId = await currentRequestId();

  let result: MovementResult & { rowId?: string };
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
        const typed = reviewed.data as unknown as ImportOperationRow[];
        const dates = typed.flatMap((row) =>
          !row.discarded && z.iso.date().safeParse(row.date).success
            ? [row.date!]
            : [],
        );
        const { ledger, truncated, symbolOf } = await ledgerForDates(
          client,
          dates,
        );
        if (truncated) throw new LedgerReadError("movements", "truncated");
        const written = writeImportOperations(
          ledger,
          item,
          withoutLoaded(ledger, item.accountId, typed),
          () => crypto.randomUUID(),
        );
        if (!written.result.ok) {
          result = {
            ...written.result,
            ...(written.rowId && { rowId: written.rowId }),
          };
        } else {
          operations = written.operations.length;
          ({ result, failure } = await sendConfirm(
            client,
            item.id,
            ledger,
            symbolOf,
            written,
          ));
        }
      }
    } catch (error) {
      result = { ok: false, code: "failed" };
      failure = error;
    }
  }

  await logConfirm({
    requestId,
    userId: claims.sub,
    importId: id.success ? id.data : undefined,
    draft: "operations",
    operations,
    started,
    result,
    failure,
  });
  return result;
}

// A debt the review kept, as confirm_import_debts takes it: a new card debt,
// named, or the user's card debt it updates.
const reviewedDebtSchema = z
  .object({
    liabilityId: z.uuid().nullable(),
    label: z.string().trim().min(1).max(LIABILITY_LABEL_MAX).nullable(),
    lender: z.string().trim().min(1).max(LIABILITY_LABEL_MAX).nullable(),
    currency: currencySchema,
    balance: positiveDecimalSchema,
    minimumPayment: positiveDecimalSchema.nullable(),
    dueDate: z.iso.date().nullable(),
  })
  .loose()
  .refine((debt) => debt.liabilityId !== null || debt.label !== null);

// Writes the debts a review kept from a card statement and marks the import
// confirmed, in confirm_import_debts' one transaction.
export async function confirmImportDebts(
  importId: unknown,
  rows: unknown,
): Promise<MovementResult> {
  // Outside any try: its redirect to /login or /auth/mfa must propagate.
  const claims = await getSessionClaims();
  const started = performance.now();
  const requestId = await currentRequestId();

  let result: MovementResult;
  let failure: unknown;
  let debts = 0;
  const id = z.uuid().safeParse(importId);
  const kept = z
    .array(z.object({ discarded: z.boolean() }).loose())
    .max(DRAFT_DEBT_LIMIT)
    .safeParse(rows);
  const reviewed = z
    .array(reviewedDebtSchema)
    // Two debts of one statement never update the same card debt.
    .refine((debts) => {
      const updated = debts.flatMap((debt) =>
        debt.liabilityId === null ? [] : [debt.liabilityId],
      );
      return new Set(updated).size === updated.length;
    })
    .safeParse((kept.data ?? []).filter((row) => !row.discarded));
  if (!id.success || !kept.success || !reviewed.success) {
    result = { ok: false, code: "invalid" };
  } else {
    try {
      const client: Client = await createClient();
      debts = reviewed.data.length;
      const response = await client.rpc("confirm_import_debts", {
        p_import_id: id.data,
        p_debts: reviewed.data.map((debt) => ({
          liability_id: debt.liabilityId,
          label: debt.label,
          lender: debt.lender,
          currency: debt.currency,
          balance: debt.balance,
          installment: debt.minimumPayment,
          next_due_on: debt.dueDate,
        })),
      });
      if (!classifyPostgrestResult(response, 200)) {
        result = { ok: true, id: id.data };
      } else {
        const error = response.error ?? {};
        // A CHECK the input passed but the database holds: a date out of
        // range.
        const code =
          "code" in error && error.code === "23514"
            ? "invalid"
            : rpcFailure(error);
        result = { ok: false, code };
        if (code === "failed") failure = response.error;
      }
    } catch (error) {
      result = { ok: false, code: "failed" };
      failure = error;
    }
  }

  await logConfirm({
    requestId,
    userId: claims.sub,
    importId: id.success ? id.data : undefined,
    draft: "debts",
    operations: debts,
    started,
    result,
    failure,
  });
  return result;
}
