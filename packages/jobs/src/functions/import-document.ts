import {
  type ImportDraft,
  SourceError,
  type SourceErrorCode,
} from "@plant/sources";
import type { Logger } from "@plant/shared";
import { NonRetriableError } from "inngest";

import { inngest } from "../client";

export const IMPORT_REQUESTED_EVENT = "plant/import.requested";

// An import as the job reads it: whose it is, where it stands, and its file.
export type ImportToRead = {
  userId: string;
  status: "queued" | "reading" | "ready" | "failed" | "confirmed";
  path: string;
  mimeType: string;
};

// Where the job reads an import and its file and writes what it read; the
// composition root implements it with the service role. Every call filters by
// the import's id, and saveDraft replaces any draft a failed attempt left.
export interface ImportStorePort {
  load(importId: string): Promise<ImportToRead | null>;
  download(path: string): Promise<Uint8Array>;
  reading(importId: string): Promise<void>;
  saveDraft(
    importId: string,
    userId: string,
    draft: ImportDraft,
  ): Promise<void>;
  failed(importId: string, failure: SourceErrorCode): Promise<void>;
}

export type ImportJobDeps = {
  store: ImportStorePort;
  // Reads a file's holdings, throwing a SourceError when it cannot.
  extract(input: {
    bytes: Uint8Array;
    mimeType: string;
    userId: string;
  }): Promise<ImportDraft>;
  log: Logger;
};

// What a step returns: ids, counts and codes only. The file and the draft
// never cross a step boundary, because memoized step output is what the
// caller sends back when signatures are off.
type Prepared =
  | { ok: true; path: string; mimeType: string }
  | { ok: false; reason: "missing" | "not_queued" | "path" };
type Read = { rows: number };

export type ImportSteps = {
  run<T>(id: string, fn: () => Promise<T>): Promise<T>;
};

type RunContext = {
  step: ImportSteps;
  runId: string;
  attempt: number;
  event: { data: { importId: string; userId: string } };
};

// Ends the import: a SourceError that a retry would not pass, or a retryable
// one past its retries.
const failureOf = (error: unknown): SourceErrorCode =>
  error instanceof SourceError ? error.code : "extraction_failed";

// Reads one queued import's file into its draft. The event names the import
// and its user; the job trusts neither: the import must be that user's,
// queued, with its file under that user's folder. A step's id never changes:
// an import in flight may resume on newer code.
export async function runImportDocument(
  deps: ImportJobDeps,
  { step, runId, attempt, event }: RunContext,
): Promise<{ outcome: "ready" | "failed" | "skipped"; rows?: number }> {
  const { importId, userId } = event.data;
  const fields = {
    "plant.inngest.run_id": runId,
    "plant.inngest.attempt": attempt,
    "plant.import.id": importId,
    "enduser.id": userId,
  };

  const prepared = await step.run("prepare", async (): Promise<Prepared> => {
    const found = await deps.store.load(importId);
    if (!found || found.userId !== userId)
      return { ok: false, reason: "missing" };
    if (found.status !== "queued" && found.status !== "reading") {
      return { ok: false, reason: "not_queued" };
    }
    if (!found.path.startsWith(`${userId}/imports/`)) {
      return { ok: false, reason: "path" };
    }
    await deps.store.reading(importId);
    return { ok: true, path: found.path, mimeType: found.mimeType };
  });
  if (!prepared.ok) {
    deps.log.warn("imports.read", {
      ...fields,
      "plant.outcome": "skipped",
      "plant.import.skip_reason": prepared.reason,
    });
    return { outcome: "skipped" };
  }

  let read: Read;
  try {
    read = await step.run("read", async (): Promise<Read> => {
      try {
        const bytes = await deps.store.download(prepared.path);
        const draft = await deps.extract({
          bytes,
          mimeType: prepared.mimeType,
          userId,
        });
        if (draft.rows.length === 0) {
          throw new SourceError("nothing_found", false);
        }
        await deps.store.saveDraft(importId, userId, draft);
        return { rows: draft.rows.length };
      } catch (error) {
        if (error instanceof SourceError && !error.retryable) {
          throw new NonRetriableError(error.code, { cause: error });
        }
        throw error;
      }
    });
  } catch (error) {
    const cause = error instanceof NonRetriableError ? error.cause : error;
    const failure = failureOf(cause);
    await step.run("fail", () => deps.store.failed(importId, failure));
    deps.log.warn("imports.read", {
      ...fields,
      "plant.outcome": "failed",
      "error.type": failure,
    });
    return { outcome: "failed" };
  }

  deps.log.info("imports.read", {
    ...fields,
    "plant.outcome": "ok",
    "plant.import.row_count": read.rows,
  });
  return { outcome: "ready", rows: read.rows };
}

export const importDocument = (deps: ImportJobDeps) =>
  inngest.createFunction(
    {
      id: "import-document",
      triggers: [{ event: IMPORT_REQUESTED_EVENT }],
      // One file at a time per user, so one user's statements do not hold
      // everyone else's.
      concurrency: { key: "event.data.userId", limit: 1 },
      retries: 3,
    },
    ({ step, runId, attempt, event }) => {
      const { importId, userId } = event.data as Record<string, unknown>;
      if (typeof importId !== "string" || typeof userId !== "string") {
        throw new NonRetriableError("imports.read without an import");
      }
      return runImportDocument(deps, {
        // Every step's output here is JSON already: ids, strings and counts.
        step: {
          run: <T>(id: string, fn: () => Promise<T>) =>
            step.run(id, fn) as unknown as Promise<T>,
        },
        runId,
        attempt,
        event: { data: { importId, userId } },
      });
    },
  );
