import { type ExchangeProvider, exchangeProviderSchema } from "@plant/sources";
import { z } from "zod";

// What an import reads, as a select on imports: an uploaded document, or for
// a sync the account and its exchange. The database holds it to one.
export const IMPORT_ORIGIN_COLUMNS =
  "source_connection_id, provider, " +
  "document:uploaded_documents!imports_user_id_document_id_fkey(file_name, source_connection_id)";

export const importOriginSchema = z.object({
  source_connection_id: z.string().nullish(),
  provider: exchangeProviderSchema.nullish(),
  document: z
    .object({ file_name: z.string(), source_connection_id: z.string() })
    .nullable(),
});

// How Cargar names a sync, where it names a file by its name.
export const SYNC_NAMES: Record<ExchangeProvider, string> = {
  binance: "Sincronización con Binance",
};

// The import's name as Cargar lists it and its account.
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
    return {
      fileName: SYNC_NAMES[row.provider],
      accountId: row.source_connection_id,
    };
  }
  throw new Error("an import reads neither a document nor an account");
}
