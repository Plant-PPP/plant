import {
  connectionDraftSchema,
  connectionProviderSchema,
  FILE_TYPE_READERS,
} from "@plant/sources";
import { z } from "zod";

import { PROVIDERS } from "@/lib/connections/api-key";
import type { ImportOrigin } from "@/lib/imports/review";

// What an import reads, as a select on imports: an uploaded document, or for
// a sync the account, its provider and what it reads. The database holds it
// to one.
export const IMPORT_ORIGIN_COLUMNS =
  "source_connection_id, provider, sync_draft, " +
  "document:uploaded_documents!imports_user_id_document_id_fkey(file_name, mime_type, source_connection_id)";

export const importOriginSchema = z.object({
  source_connection_id: z.string().nullish(),
  provider: connectionProviderSchema.nullish(),
  sync_draft: connectionDraftSchema.nullish(),
  document: z
    .object({
      file_name: z.string(),
      mime_type: z.string(),
      source_connection_id: z.string(),
    })
    .nullable(),
});

// The import's name as Cargar lists it, its account and what it reads: a file
// by its name, a sync by its provider and what it read.
export function importOrigin(row: z.infer<typeof importOriginSchema>): {
  fileName: string;
  accountId: string;
  origin: ImportOrigin;
} {
  if (row.document) {
    const { file_name, mime_type, source_connection_id } = row.document;
    return {
      fileName: file_name,
      accountId: source_connection_id,
      origin:
        Object.hasOwn(FILE_TYPE_READERS, mime_type) &&
        FILE_TYPE_READERS[mime_type as keyof typeof FILE_TYPE_READERS] ===
          "sheet"
          ? "sheet"
          : "document",
    };
  }
  if (row.source_connection_id && row.provider) {
    const name = PROVIDERS[row.provider].name;
    return {
      fileName:
        row.sync_draft === "operations"
          ? `Operaciones de ${name}`
          : `Sincronización con ${name}`,
      accountId: row.source_connection_id,
      origin: "sync",
    };
  }
  throw new Error("an import reads neither a document nor an account");
}

// The name of the provider a sync reads; null for a document.
export const syncProvider = (
  row: z.infer<typeof importOriginSchema>,
): string | null =>
  row.document === null && row.provider ? PROVIDERS[row.provider].name : null;
