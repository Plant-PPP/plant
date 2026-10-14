import {
  type ImportDraft,
  type PortfolioSourcePort,
  SourceError,
  type SourceErrorCode,
  type SourceReadInfo,
} from "@plant/sources";
import { Constants, type Database, type Logger } from "@plant/shared";
import { NonRetriableError } from "inngest";

import { inngest } from "../client";

// How many times a failed run is tried again.
export const IMPORT_RETRIES = 3;

export const IMPORT_REQUESTED_EVENT = "plant/import.requested";

// An import as the job reads it: whose it is, where it stands, and its file.
export type ImportToRead = {
  userId: string;
  status: Database["public"]["Enums"]["import_status"];
  path: string;
  mimeType: string;
};

// Where the job reads an import and its file and writes what it read; the
// composition root implements it with the service role. Every call filters by
// the import's id and its user, and saveDraft replaces any draft a failed
// attempt left.
export interface ImportStorePort {
  load(importId: string, userId: string): Promise<ImportToRead | null>;
  download(path: string): Promise<Uint8Array>;
  reading(importId: string, userId: string): Promise<void>;
  // The institution of the account the import's file was uploaded to.
  institution(importId: string, userId: string): Promise<string>;
  // `skippedRows` are the holdings the reading left out, for the review to
  // say.
  saveDraft(
    importId: string,
    userId: string,
    draft: ImportDraft,
    skippedRows: number,
  ): Promise<void>;
  failed(
    importId: string,
    userId: string,
    failure: SourceErrorCode,
  ): Promise<void>;
}

export type ImportJobDeps = {
  store: ImportStorePort;
  // The connection's source reads a file's holdings, throwing a
  // SourceError when it cannot.
  source: PortfolioSourcePort;
  log: Logger;
};

// What a step returns: ids, counts and codes only. The file and the draft
// never cross a step boundary, because memoized step output is what the
// caller sends back when signatures are off.
type Prepared =
  | { ok: true; path: string; mimeType: string }
  | { ok: false; reason: "missing" | "not_queued" | "path" };
type Read = { rows: number } & SourceReadInfo;

export type ImportSteps = {
  run<T>(id: string, fn: () => Promise<T>): Promise<T>;
};

type RunContext = {
  step: ImportSteps;
  runId: string;
  attempt: number;
  event: { data: { importId: string; userId: string } };
};

const FAILURES: readonly string[] = Constants.public.Enums.import_failure;
const isFailure = (value: unknown): value is SourceErrorCode =>
  typeof value === "string" && FAILURES.includes(value);

// Ends the import: a SourceError that a retry would not pass, or a retryable
// one past its retries. The engine hands a step's error back rebuilt from
// JSON, without its class, so the code is read from what survives: a
// SourceError's code, a NonRetriableError's message (the code), or
// SourceError's message, down the causes.
export function failureOf(error: unknown): SourceErrorCode {
  let current = error;
  for (let depth = 0; depth < 4 && current; depth += 1) {
    if (typeof current !== "object") break;
    const { code, message, cause } = current as {
      code?: unknown;
      message?: unknown;
      cause?: unknown;
    };
    if (isFailure(code)) return code;
    if (isFailure(message)) return message;
    const named =
      typeof message === "string"
        ? /^source failed: (\w+)$/.exec(message)?.[1]
        : undefined;
    if (isFailure(named)) return named;
    current = cause;
  }
  return "extraction_failed";
}

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
    const found = await deps.store.load(importId, userId);
    if (!found || found.userId !== userId)
      return { ok: false, reason: "missing" };
    if (found.status !== "queued" && found.status !== "reading") {
      return { ok: false, reason: "not_queued" };
    }
    if (!found.path.startsWith(`${userId}/imports/`)) {
      return { ok: false, reason: "path" };
    }
    await deps.store.reading(importId, userId);
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
        const { draft, read } = await deps.source.read({
          importId,
          bytes,
          mimeType: prepared.mimeType,
          userId,
          institution: await deps.store.institution(importId, userId),
          lastAttempt: attempt >= IMPORT_RETRIES,
        });
        if (draft.rows.length === 0) {
          throw new SourceError("nothing_found", false);
        }
        await deps.store.saveDraft(importId, userId, draft, read.skippedRows);
        return { rows: draft.rows.length, ...read };
      } catch (error) {
        if (error instanceof SourceError && !error.retryable) {
          throw new NonRetriableError(error.code, { cause: error });
        }
        throw error;
      }
    });
  } catch (error) {
    const failure = failureOf(error);
    await step.run("fail", () => deps.store.failed(importId, userId, failure));
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
    "plant.import.reader": read.reader,
    "plant.import.mapping": read.mapping,
    "plant.import.skipped_count": read.skippedRows,
    "plant.import.dispute_count": read.disputes,
  });
  return { outcome: "ready", rows: read.rows };
}

// Ends an import whose run died past its retries without reaching "fail"
// (the process ran out of memory or time), so it never stays "reading".
export async function failAbandonedImport(
  deps: Pick<ImportJobDeps, "store" | "log">,
  data: unknown,
): Promise<void> {
  const { importId, userId } = (data ?? {}) as Record<string, unknown>;
  if (typeof importId !== "string" || typeof userId !== "string") {
    deps.log.warn("imports.read", {
      "plant.outcome": "skipped",
      "plant.import.skip_reason": "no_import",
    });
    return;
  }
  const fields = { "plant.import.id": importId, "enduser.id": userId };
  const found = await deps.store.load(importId, userId);
  if (!found || found.userId !== userId) {
    deps.log.warn("imports.read", {
      ...fields,
      "plant.outcome": "skipped",
      "plant.import.skip_reason": "missing",
    });
    return;
  }
  // The run ended it already, as failed or ready.
  if (found.status !== "queued" && found.status !== "reading") return;
  await deps.store.failed(importId, userId, "extraction_failed");
  deps.log.warn("imports.read", {
    ...fields,
    "plant.outcome": "failed",
    "error.type": "function_failed",
  });
}

export const importDocument = (deps: ImportJobDeps) =>
  inngest.createFunction(
    {
      id: "import-document",
      triggers: [{ event: IMPORT_REQUESTED_EVENT }],
      // One file at a time per user, so one user's statements do not hold
      // everyone else's.
      concurrency: { key: "event.data.userId", limit: 1 },
      retries: IMPORT_RETRIES,
      onFailure: ({ event }) =>
        failAbandonedImport(deps, event.data.event.data),
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
