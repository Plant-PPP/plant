import "server-only";
import type { DueFile, FileDeletionStorePort } from "@plant/jobs";
import type { Database } from "@plant/shared";
import type { SupabaseClient } from "@supabase/supabase-js";

import { UPLOAD_BUCKET } from "@/lib/imports/upload";
import { classifyPostgrestResult } from "@/lib/supabase/postgrest-write";

type Client = SupabaseClient<Database>;

// Only the step and the code are kept, never the error's details, which may
// carry a path.
export class FileDeletionStoreError extends Error {
  override readonly name = "FileDeletionStoreError";
  constructor(
    readonly step: "due" | "remove" | "mark",
    readonly code: string,
  ) {
    super(`file deletion store ${step} failed: ${code}`);
  }
}

// The deletion job's store over a service-role client: past RLS and Storage's
// policies, across every user, reading and touching only rows whose
// delete_after has passed and whose file is still there.
export function createFileDeletionStore(client: Client): FileDeletionStorePort {
  return {
    async due(now, limit): Promise<DueFile[]> {
      const result = await client
        .from("uploaded_documents")
        .select("id, storage_path")
        .is("file_deleted_at", null)
        .lt("delete_after", now.toISOString())
        .order("delete_after")
        .limit(limit);
      const failure = classifyPostgrestResult(result, 200);
      if (failure) throw new FileDeletionStoreError("due", failure.code);
      return (result.data ?? []).map((row) => ({
        id: row.id,
        path: row.storage_path,
      }));
    },

    async remove(paths) {
      if (paths.length === 0) return;
      const { error } = await client.storage
        .from(UPLOAD_BUCKET)
        .remove([...paths]);
      if (error) throw new FileDeletionStoreError("remove", error.name);
    },

    async markDeleted(ids, at) {
      if (ids.length === 0) return;
      const failure = classifyPostgrestResult(
        await client
          .from("uploaded_documents")
          .update({ file_deleted_at: at.toISOString() })
          .in("id", [...ids])
          .is("file_deleted_at", null),
        204,
      );
      if (failure) throw new FileDeletionStoreError("mark", failure.code);
    },
  };
}
