import "server-only";
import type { Database } from "@plant/shared";
import type { SupabaseClient } from "@supabase/supabase-js";
import { UPLOAD_BUCKET } from "@/lib/imports/upload";
import { classifyPostgrestResult } from "@/lib/supabase/postgrest-write";
import { PortfolioSetupError } from "./errors";
import type { Refusal } from "./run-write";

// Before an account is deleted, its uploads' files leave Storage, as the
// user: the rows, their imports and drafts then go with the account through
// their foreign keys, and nothing would find the files afterwards. An account
// a holding sits in is refused here, before any file goes; the guard still
// refuses one a holding reaches meanwhile, leaving rows whose file is gone.
// Storage leaves out of its answer a file already gone as well as one it
// refused, so only its error keeps the account: a retry after such a refusal
// finds the files gone, and any file left behind loses its row with the
// account, which the orphan-file job then removes.
export async function removeAccountUploads({
  client,
  userId,
  id,
}: {
  client: SupabaseClient<Database>;
  userId: string;
  id: string;
}): Promise<Refusal | null> {
  const held = await client
    .from("holdings")
    .select("id")
    .eq("user_id", userId)
    .eq("source_connection_id", id)
    .limit(1);
  const heldFailure = classifyPostgrestResult(held, 200);
  if (heldFailure) {
    return {
      refused: "failed",
      error: new PortfolioSetupError(heldFailure.code),
    };
  }
  if ((held.data ?? []).length > 0) {
    return { refused: "source_connection_has_holdings" };
  }

  const documents = await client
    .from("uploaded_documents")
    .select("storage_path")
    .eq("user_id", userId)
    .eq("source_connection_id", id)
    .is("file_deleted_at", null);
  const documentsFailure = classifyPostgrestResult(documents, 200);
  if (documentsFailure) {
    return {
      refused: "failed",
      error: new PortfolioSetupError(documentsFailure.code),
    };
  }
  const paths = (documents.data ?? []).map((row) => row.storage_path);
  if (paths.length === 0) return null;
  const { error } = await client.storage.from(UPLOAD_BUCKET).remove(paths);
  if (error) {
    return {
      refused: "failed",
      error: new PortfolioSetupError("storage_remove"),
    };
  }
  return null;
}
