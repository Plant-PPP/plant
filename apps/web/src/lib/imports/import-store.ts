import "server-only";
import type { ImportStorePort, ImportToRead } from "@plant/jobs";
import { Constants, type Database } from "@plant/shared";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { UPLOAD_BUCKET } from "@/lib/imports/upload";
import { classifyPostgrestResult } from "@/lib/supabase/postgrest-write";

type Client = SupabaseClient<Database>;

// A store that failed: the step retries it, and past its retries the import
// fails as extraction_failed. Only the step and the code are kept, never the
// error's details, which may carry a row.
export class ImportStoreError extends Error {
  override readonly name = "ImportStoreError";
  constructor(
    readonly step:
      "load" | "download" | "reading" | "institution" | "draft" | "failed",
    readonly code: string,
  ) {
    super(`import store ${step} failed: ${code}`);
  }
}

// The job moves an import only while it is being read.
const BEING_READ: Database["public"]["Enums"]["import_status"][] = [
  "queued",
  "reading",
];

const loadedSchema = z.object({
  user_id: z.string(),
  status: z.enum(Constants.public.Enums.import_status),
  document: z.object({ storage_path: z.string(), mime_type: z.string() }),
});

const institutionSchema = z.object({
  document: z.object({ account: z.object({ institution: z.string() }) }),
});

function checked(
  step: ImportStoreError["step"],
  result: Parameters<typeof classifyPostgrestResult>[0],
  expected: number,
) {
  const failure = classifyPostgrestResult(result, expected);
  if (failure) throw new ImportStoreError(step, failure.code);
}

// The job's store over a service-role client: it bypasses RLS and Storage's
// policies, so every call filters by the import's id and by its user, and the
// job checks the import is its event's user's before it reads the file.
export function createImportStore(client: Client): ImportStorePort {
  // Whether the import is still being read, and if so clears any draft, of
  // holdings or of operations, an earlier attempt wrote: a retried read may
  // tell the document apart differently. A read retried after the import was
  // confirmed or failed writes nothing.
  const clearDraft = async (importId: string, userId: string) => {
    const current = await client
      .from("imports")
      .select("id")
      .eq("id", importId)
      .eq("user_id", userId)
      .in("status", BEING_READ)
      .limit(1);
    checked("draft", current, 200);
    if ((current.data ?? []).length === 0) return false;
    for (const table of [
      "import_items",
      "import_operations",
      "import_debts",
    ] as const) {
      checked(
        "draft",
        await client
          .from(table)
          .delete()
          .eq("import_id", importId)
          .eq("user_id", userId),
        204,
      );
    }
    return true;
  };

  const markReady = async (
    importId: string,
    userId: string,
    fields: {
      document_date: string | null;
      printed_total_ars: number | null;
      printed_total_usd: number | null;
      skipped_rows: number;
    },
  ) => {
    const marked = await client
      .from("imports")
      .update({ status: "ready", ...fields })
      .eq("id", importId)
      .eq("user_id", userId)
      .in("status", BEING_READ)
      .select("id");
    checked("draft", marked, 200);
    if ((marked.data ?? []).length === 0) {
      throw new ImportStoreError("draft", "not_being_read");
    }
  };

  return {
    async load(importId, userId): Promise<ImportToRead | null> {
      const result = await client
        .from("imports")
        .select(
          "user_id, status, " +
            "document:uploaded_documents!imports_user_id_document_id_fkey(storage_path, mime_type)",
        )
        .eq("id", importId)
        .eq("user_id", userId)
        .limit(1);
      checked("load", result, 200);
      const [row] = (result.data ?? []) as unknown[];
      if (row === undefined) return null;
      const { user_id, status, document } = loadedSchema.parse(row);
      return {
        userId: user_id,
        status,
        path: document.storage_path,
        mimeType: document.mime_type,
      };
    },

    async download(path) {
      const { data, error } = await client.storage
        .from(UPLOAD_BUCKET)
        .download(path);
      if (error || !data) {
        throw new ImportStoreError("download", error?.name ?? "no_data");
      }
      return new Uint8Array(await data.arrayBuffer());
    },

    async reading(importId, userId) {
      checked(
        "reading",
        await client
          .from("imports")
          .update({ status: "reading" })
          .eq("id", importId)
          .eq("user_id", userId)
          .in("status", BEING_READ),
        204,
      );
    },

    async institution(importId, userId) {
      const result = await client
        .from("imports")
        .select(
          "document:uploaded_documents!imports_user_id_document_id_fkey(" +
            "account:source_connections!uploaded_documents_user_id_source_connection_id_fkey(institution))",
        )
        .eq("id", importId)
        .eq("user_id", userId)
        .limit(1);
      checked("institution", result, 200);
      const [row] = (result.data ?? []) as unknown[];
      const parsed = institutionSchema.safeParse(row);
      if (!parsed.success) throw new ImportStoreError("institution", "no_data");
      return parsed.data.document.account.institution;
    },

    async saveDraft(importId, userId, draft, skippedRows) {
      if (!(await clearDraft(importId, userId))) return;
      // Amounts stay decimal strings; the cast is only for the generated types.
      const rows = draft.rows.map((row, position) => ({
        user_id: userId,
        import_id: importId,
        position,
        symbol: row.symbol,
        quantity: row.quantity as unknown as number,
        price: row.price as unknown as number | null,
        value: row.value as unknown as number | null,
        cost: (row.cost ?? null) as unknown as number | null,
        account: row.account ?? null,
        currency: row.currency,
        confidence: row.confidence,
        source_page: row.page,
      }));
      checked("draft", await client.from("import_items").insert(rows), 201);
      const printed = (currency: "ARS" | "USD") =>
        (draft.totals.find((total) => total.currency === currency)?.amount ??
          null) as unknown as number | null;
      await markReady(importId, userId, {
        document_date: draft.documentDate,
        printed_total_ars: printed("ARS"),
        printed_total_usd: printed("USD"),
        skipped_rows: skippedRows,
      });
    },

    async saveOperations(importId, userId, operations) {
      if (!(await clearDraft(importId, userId))) return;
      // Amounts stay decimal strings; the cast is only for the generated types.
      const decimal = (value: string | null) =>
        value as unknown as number | null;
      const rows = operations.map((operation, position) => ({
        user_id: userId,
        import_id: importId,
        position,
        date: operation.date,
        kind: operation.kind,
        symbol: operation.symbol,
        quantity: decimal(operation.quantity),
        price: decimal(operation.price),
        amount: decimal(operation.amount),
        charges: decimal(operation.charges),
        reference: operation.reference,
        currency: operation.currency,
        confidence: operation.confidence,
        source_page: operation.page,
      }));
      checked(
        "draft",
        await client.from("import_operations").insert(rows),
        201,
      );
      await markReady(importId, userId, {
        document_date: null,
        printed_total_ars: null,
        printed_total_usd: null,
        skipped_rows: 0,
      });
    },

    async saveDebts(importId, userId, debts) {
      if (!(await clearDraft(importId, userId))) return;
      // Amounts stay decimal strings; the cast is only for the generated types.
      const decimal = (value: string | null) =>
        value as unknown as number | null;
      const rows = debts.map((debt, position) => ({
        user_id: userId,
        import_id: importId,
        position,
        label: debt.label,
        lender: debt.lender,
        currency: debt.currency,
        balance: decimal(debt.balance),
        minimum_payment: decimal(debt.minimumPayment),
        due_date: debt.dueDate,
        confidence: debt.confidence,
        source_page: debt.page,
      }));
      checked("draft", await client.from("import_debts").insert(rows), 201);
      await markReady(importId, userId, {
        document_date: null,
        printed_total_ars: null,
        printed_total_usd: null,
        skipped_rows: 0,
      });
    },

    async failed(importId, userId, failure) {
      checked(
        "failed",
        await client
          .from("imports")
          .update({ status: "failed", failure })
          .eq("id", importId)
          .eq("user_id", userId)
          .in("status", BEING_READ),
        204,
      );
    },
  };
}
