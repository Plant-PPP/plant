import "server-only";
import type { OrphanFile, OrphanFileStorePort } from "@plant/jobs";
import type { Database } from "@plant/shared";
import type { SupabaseClient } from "@supabase/supabase-js";

import { UPLOAD_BUCKET } from "@/lib/imports/upload";
import { classifyPostgrestResult } from "@/lib/supabase/postgrest-write";

type Client = SupabaseClient<Database>;

// Only the step and the code are kept, never the error's details, which may
// carry a path.
export class OrphanFileStoreError extends Error {
  override readonly name = "OrphanFileStoreError";
  constructor(
    readonly step: "orphans" | "remove",
    readonly code: string,
  ) {
    super(`orphan file store ${step} failed: ${code}`);
  }
}

// The orphan files job's store over a service-role client: past Storage's
// policies, across every user, it finds and removes only objects that
// public.orphan_import_files returns.
export function createOrphanFileStore(client: Client): OrphanFileStorePort {
  return {
    async orphans(limit, after): Promise<OrphanFile[]> {
      const result = await client.rpc("orphan_import_files", {
        p_limit: limit,
        ...(after === null ? {} : { p_after: after }),
      });
      const failure = classifyPostgrestResult(result, 200);
      if (failure) throw new OrphanFileStoreError("orphans", failure.code);
      return (result.data ?? []).map((row) => ({
        id: row.id,
        path: row.name,
      }));
    },

    async remove(paths) {
      if (paths.length === 0) return;
      const { error } = await client.storage
        .from(UPLOAD_BUCKET)
        .remove([...paths]);
      if (error) throw new OrphanFileStoreError("remove", error.name);
    },
  };
}
