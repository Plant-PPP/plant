import {
  connectionDraftSchema,
  connectionProviderSchema,
} from "@plant/sources";
import { z } from "zod";

import { PROVIDERS } from "@/lib/connections/api-key";

// What an import reads, as a select on imports: an uploaded document, or for
// a sync the account, its provider and what it reads. The database holds it
// to one.
export const IMPORT_ORIGIN_COLUMNS =
  "source_connection_id, provider, sync_draft, " +
  "document:uploaded_documents!imports_user_id_document_id_fkey(file_name, source_connection_id)";

export const importOriginSchema = z.object({
  source_connection_id: z.string().nullish(),
  provider: connectionProviderSchema.nullish(),
  sync_draft: connectionDraftSchema.nullish(),
  document: z
    .object({ file_name: z.string(), source_connection_id: z.string() })
    .nullable(),
});

// The import's name as Cargar lists it and its account: a file by its name,
// a sync by its provider and what it read.
export function importOrigin(row: z.infer<typeof importOriginSchema>): {
  fileName: string;
  accountId: string;
} {
  if (row.document) {
    return {
      fileName: row.document.file_name,
      accountId: row.document.source_connection_id,
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
    };
  }
  throw new Error("an import reads neither a document nor an account");
}

// The name of the provider a sync reads; null for a document.
export const syncProvider = (
  row: z.infer<typeof importOriginSchema>,
): string | null =>
  row.document === null && row.provider ? PROVIDERS[row.provider].name : null;
