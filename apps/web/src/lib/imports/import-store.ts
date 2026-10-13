import "server-only";
import type { ImportStorePort, ImportToRead } from "@plant/jobs";
import type { Database } from "@plant/shared";
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
    readonly step: "load" | "download" | "reading" | "draft" | "failed",
    readonly code: string,
  ) {
    super(`import store ${step} failed: ${code}`);
  }
}

const loadedSchema = z.object({
  user_id: z.string(),
  status: z.enum(["queued", "reading", "ready", "failed", "confirmed"]),
  document: z.object({ storage_path: z.string(), mime_type: z.string() }),
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
// policies, so every call filters by the import's id, and the job checks the
// import is its event's user's before it reads the file.
export function createImportStore(client: Client): ImportStorePort {
  return {
    async load(importId): Promise<ImportToRead | null> {
      const result = await client
        .from("imports")
        .select(
          "user_id, status, " +
            "document:uploaded_documents!imports_user_id_document_id_fkey(storage_path, mime_type)",
        )
        .eq("id", importId)
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

    async reading(importId) {
      checked(
        "reading",
        await client
          .from("imports")
          .update({ status: "reading" })
          .eq("id", importId),
        204,
      );
    },

    async saveDraft(importId, userId, draft) {
      // A retried read replaces what an earlier attempt may have written.
      checked(
        "draft",
        await client.from("import_items").delete().eq("import_id", importId),
        204,
      );
      // Amounts stay decimal strings; the cast is only for the generated types.
      const rows = draft.rows.map((row, position) => ({
        user_id: userId,
        import_id: importId,
        position,
        symbol: row.symbol,
        quantity: row.quantity as unknown as number,
        price: row.price as unknown as number | null,
        currency: row.currency,
        confidence: row.confidence,
        source_page: row.page,
      }));
      checked("draft", await client.from("import_items").insert(rows), 201);
      checked(
        "draft",
        await client
          .from("imports")
          .update({ status: "ready", document_date: draft.documentDate })
          .eq("id", importId),
        204,
      );
    },

    async failed(importId, failure) {
      checked(
        "failed",
        await client
          .from("imports")
          .update({ status: "failed", failure })
          .eq("id", importId),
        204,
      );
    },
  };
}
