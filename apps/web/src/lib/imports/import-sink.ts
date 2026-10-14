import "server-only";
import type {
  FileDeletionStorePort,
  ImportStorePort,
  OrphanFileStorePort,
} from "@plant/jobs";

import { secretsKey } from "@/lib/connections/secret-box";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

import {
  ColumnMappingsError,
  type ColumnMappingsPort,
  createColumnMappingsStore,
} from "./column-mappings-store";
import {
  createFileDeletionStore,
  FileDeletionStoreError,
} from "./file-deletion-store";
import { createImportStore, ImportStoreError } from "./import-store";
import {
  createOrphanFileStore,
  OrphanFileStoreError,
} from "./orphan-file-store";

// Reads any user's import and file, or the sealed key of the account a sync
// reads, and writes its draft, past RLS and Storage's policies: only the
// Inngest route may import it.
export function importSink(): ImportStorePort {
  const client = createServiceRoleClient();
  if (!client) {
    const unconfigured = () =>
      Promise.reject(new ImportStoreError("load", "unconfigured"));
    return {
      load: unconfigured,
      download: unconfigured,
      reading: unconfigured,
      institution: unconfigured,
      credentials: unconfigured,
      saveDraft: unconfigured,
      saveOperations: unconfigured,
      saveDebts: unconfigured,
      failed: unconfigured,
    };
  }
  return createImportStore(client, secretsKey());
}

// Reads and adds any user's spreadsheet column mappings, past RLS.
export function columnMappingsSink(): ColumnMappingsPort {
  const client = createServiceRoleClient();
  if (!client) {
    return {
      get: () => Promise.reject(new ColumnMappingsError("get", "unconfigured")),
      save: () =>
        Promise.reject(new ColumnMappingsError("save", "unconfigured")),
    };
  }
  return createColumnMappingsStore(client);
}

// Removes any user's due files, past RLS and Storage's policies.
export function fileDeletionSink(): FileDeletionStorePort {
  const client = createServiceRoleClient();
  if (!client) {
    const unconfigured = () =>
      Promise.reject(new FileDeletionStoreError("due", "unconfigured"));
    return {
      due: unconfigured,
      remove: unconfigured,
      markDeleted: unconfigured,
    };
  }
  return createFileDeletionStore(client);
}

// Removes any user's files no document points at, past Storage's policies.
export function orphanFileSink(): OrphanFileStorePort {
  const client = createServiceRoleClient();
  if (!client) {
    return {
      orphans: () =>
        Promise.reject(new OrphanFileStoreError("orphans", "unconfigured")),
      remove: () =>
        Promise.reject(new OrphanFileStoreError("remove", "unconfigured")),
    };
  }
  return createOrphanFileStore(client);
}
