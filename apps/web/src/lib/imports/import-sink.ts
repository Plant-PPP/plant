import "server-only";
import type { ImportStorePort } from "@plant/jobs";

import { createServiceRoleClient } from "@/lib/supabase/service-role";

import { createImportStore, ImportStoreError } from "./import-store";

// Reads any user's import and file and writes its draft, past RLS and
// Storage's policies: only the Inngest route may import it.
export function importSink(): ImportStorePort {
  const client = createServiceRoleClient();
  if (!client) {
    const unconfigured = () =>
      Promise.reject(new ImportStoreError("load", "unconfigured"));
    return {
      load: unconfigured,
      download: unconfigured,
      reading: unconfigured,
      saveDraft: unconfigured,
      failed: unconfigured,
    };
  }
  return createImportStore(client);
}
