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

// What the assistant proposed and the user staged from its card: an import
// of an account with no file and no API behind it.
export const ASSISTANT_PROVIDER = "assistant";

export const importOriginSchema = z.object({
  source_connection_id: z.string().nullish(),
  provider: z
    .union([connectionProviderSchema, z.literal(ASSISTANT_PROVIDER)])
    .nullish(),
  sync_draft: connectionDraftSchema.nullish(),
  document: z
    .object({
      file_name: z.string(),
      mime_type: z.string(),
      source_connection_id: z.string().nullable(),
    })
    .nullable(),
});

// The import's name as Cargar lists it, its account (none for a file uploaded
// to no account) and what it reads: a file by its name, a sync by its
// provider and what it read.
export function importOrigin(row: z.infer<typeof importOriginSchema>): {
  fileName: string;
  accountId: string | null;
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
  if (row.source_connection_id && row.provider === ASSISTANT_PROVIDER) {
    return {
      fileName:
        row.sync_draft === "operations"
          ? "Operaciones del asistente"
          : "Tenencias del asistente",
      accountId: row.source_connection_id,
      origin: "sync",
    };
  }
  if (
    row.source_connection_id &&
    row.provider &&
    row.provider !== ASSISTANT_PROVIDER
  ) {
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
  row.document === null && row.provider
    ? row.provider === ASSISTANT_PROVIDER
      ? "Asistente"
      : PROVIDERS[row.provider].name
    : null;
