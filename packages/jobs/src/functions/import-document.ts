import {
  type DraftDebt,
  type DraftOperation,
  type ConnectionAdapters,
  type ConnectionDraft,
  type ConnectionProvider,
  type ImportDraft,
  type PortfolioSourcePort,
  SourceError,
  type SourceErrorCode,
  type SourceReadInfo,
  type SourceReading,
} from "@plant/sources";
import { Constants, type Database, type Logger } from "@plant/shared";
import { NonRetriableError } from "inngest";

import { inngest } from "../client";

// How many times a failed run is tried again.
export const IMPORT_RETRIES = 3;

export const IMPORT_REQUESTED_EVENT = "plant/import.requested";

// An import as the job reads it: whose it is, where it stands, and what it
// reads: an uploaded file, or an account's holdings or operations at its
// broker or exchange (a sync).
export type ImportToRead = {
  userId: string;
  status: Database["public"]["Enums"]["import_status"];
} & (
  | { origin: "file"; path: string; mimeType: string }
  | {
      origin: "connection";
      accountId: string;
      provider: ConnectionProvider;
      draft: ConnectionDraft;
    }
);

// Where the job reads an import and its file and writes what it read; the
// composition root implements it with the service role. Every call filters by
// the import's id and its user, and saving a draft of holdings or of
// operations replaces any draft, of either, a failed attempt left. A call
// that fails throws an error named ImportStoreError with the `step` and the
// `code` that failed, the only parts of it the job keeps.
export interface ImportStorePort {
  load(importId: string, userId: string): Promise<ImportToRead | null>;
  download(path: string): Promise<Uint8Array>;
  reading(importId: string, userId: string): Promise<void>;
  // The institution of the account the import's file was uploaded to.
  institution(importId: string, userId: string): Promise<string>;
  // The credentials of that provider the user's account holds, out of
  // Vault, as stored (the provider's adapter parses them); null when
  // it holds none any more.
  credentials(
    userId: string,
    accountId: string,
    provider: ConnectionProvider,
  ): Promise<unknown>;
  // `skippedRows` are the holdings the reading left out, for the review to
  // say. Each save* answers false, writing nothing, for an import no longer
  // being read (confirmed, failed or deleted meanwhile).
  saveDraft(
    importId: string,
    userId: string,
    draft: ImportDraft,
    skippedRows: number,
  ): Promise<boolean>;
  saveOperations(
    importId: string,
    userId: string,
    operations: DraftOperation[],
  ): Promise<boolean>;
  saveDebts(
    importId: string,
    userId: string,
    debts: DraftDebt[],
  ): Promise<boolean>;
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
  // Each provider's adapter reads a sync with the account's credentials.
  connections: ConnectionAdapters;
  log: Logger;
};

// What a step returns or throws: ids, counts and codes only. The file, the
// key and the draft never cross a step boundary, because memoized step output
// is what the caller sends back when signatures are off, and a step's error
// lands in the run history with its causes.
type Prepared =
  | { ok: true; origin: "file"; path: string; mimeType: string }
  | {
      ok: true;
      origin: "connection";
      accountId: string;
      provider: ConnectionProvider;
      draft: ConnectionDraft;
    }
  | { ok: false; reason: "missing" | "not_queued" | "path" };
type Read = {
  rows: number;
  draft: "holdings" | "operations" | "debts";
} & SourceReadInfo;

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

const STORE_FAILURE = /^import store (\S+) failed: (\S+)$/;

// The error a step throws in place of the one it caught. Inngest serializes a
// step's error five causes deep into the run history, and the AI SDK's errors
// under a SourceError carry the model's raw answer, so no cause goes along.
function bare(error: unknown): Error {
  if (error instanceof SourceError) {
    return error.retryable
      ? new SourceError(error.code, true)
      : new NonRetriableError(error.code);
  }
  const { name, message, step, code } = (error ?? {}) as {
    name?: unknown;
    message?: unknown;
    step?: unknown;
    code?: unknown;
  };
  const bared = new Error(
    name === "ImportStoreError" &&
      typeof step === "string" &&
      typeof code === "string"
      ? `import store ${step} failed: ${code}`
      : typeof message === "string"
        ? message
        : "step failed",
  );
  bared.name = typeof name === "string" ? name : "Error";
  return bared;
}

// The step and code of a store that failed, from the message `bare` gave it,
// which is all the engine keeps of it.
function storeFailureOf(error: unknown) {
  const { name, message } = (error ?? {}) as {
    name?: unknown;
    message?: unknown;
  };
  if (name !== "ImportStoreError" || typeof message !== "string") return null;
  const [, step, code] = STORE_FAILURE.exec(message) ?? [];
  return step && code ? { step, code } : null;
}

// Reads one queued import's file, or its account's provider, into its draft.
// The event names the import and its user; the job trusts neither: the import
// must be that user's, queued, with its file under that user's folder, and a
// sync reads only that user's key of that account. A step's id never changes:
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
    if (found.origin === "connection") {
      await deps.store.reading(importId, userId);
      return {
        ok: true,
        origin: "connection",
        accountId: found.accountId,
        provider: found.provider,
        draft: found.draft,
      };
    }
    if (!found.path.startsWith(`${userId}/imports/`)) {
      return { ok: false, reason: "path" };
    }
    await deps.store.reading(importId, userId);
    return {
      ok: true,
      origin: "file",
      path: found.path,
      mimeType: found.mimeType,
    };
  });
  if (!prepared.ok) {
    deps.log.warn("imports.read", {
      ...fields,
      "plant.outcome": "skipped",
      "plant.import.skip_reason": prepared.reason,
    });
    return { outcome: "skipped" };
  }

  let read: Read | { gone: true };
  try {
    read = await step.run("read", async (): Promise<Read | { gone: true }> => {
      try {
        let reading: SourceReading;
        if (prepared.origin === "connection") {
          const credentials = await deps.store.credentials(
            userId,
            prepared.accountId,
            prepared.provider,
          );
          // The user disconnected the key after the sync started.
          if (credentials == null) {
            throw new SourceError("connection_rejected", false);
          }
          reading = await deps.connections[prepared.provider]().read(
            credentials,
            prepared.draft,
          );
        } else {
          const bytes = await deps.store.download(prepared.path);
          reading = await deps.source.read({
            importId,
            bytes,
            mimeType: prepared.mimeType,
            userId,
            institution: await deps.store.institution(importId, userId),
            lastAttempt: attempt >= IMPORT_RETRIES,
          });
        }
        const rows =
          "operations" in reading
            ? reading.operations.length
            : "debts" in reading
              ? reading.debts.length
              : reading.draft.rows.length;
        if (rows === 0) throw new SourceError("nothing_found", false);
        const saved =
          "operations" in reading
            ? await deps.store.saveOperations(
                importId,
                userId,
                reading.operations,
              )
            : "debts" in reading
              ? await deps.store.saveDebts(importId, userId, reading.debts)
              : await deps.store.saveDraft(
                  importId,
                  userId,
                  reading.draft,
                  reading.read.skippedRows,
                );
        if (!saved) return { gone: true };
        return {
          rows,
          draft:
            "operations" in reading
              ? "operations"
              : "debts" in reading
                ? "debts"
                : "holdings",
          ...reading.read,
        };
      } catch (error) {
        throw bare(error);
      }
    });
  } catch (error) {
    const failure = failureOf(error);
    await step.run("fail", () => deps.store.failed(importId, userId, failure));
    const store = storeFailureOf(error);
    if (store) {
      deps.log.error("imports.read", {
        ...fields,
        "plant.outcome": "failed",
        "error.type": failure,
        "plant.import.store_step": store.step,
        "plant.import.store_code": store.code,
      });
    } else {
      deps.log.warn("imports.read", {
        ...fields,
        "plant.outcome": "failed",
        "error.type": failure,
      });
    }
    return { outcome: "failed" };
  }

  if ("gone" in read) {
    deps.log.warn("imports.read", {
      ...fields,
      "plant.outcome": "skipped",
      "plant.import.skip_reason": "gone",
    });
    return { outcome: "skipped" };
  }

  deps.log.info("imports.read", {
    ...fields,
    "plant.outcome": "ok",
    "plant.import.row_count": read.rows,
    "plant.import.draft": read.draft,
    "plant.import.reader": read.reader,
    "plant.import.mapping": read.mapping,
    "plant.import.skipped_count": read.skippedRows,
    "plant.import.dispute_count": read.disputes,
    "plant.import.document_kind": read.documentKind ?? "unknown",
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
