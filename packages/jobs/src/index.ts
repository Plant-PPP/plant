import type { ServeHandlerOptions } from "inngest";

import { DEV_SERVER_MODE, inngest } from "./client";
import {
  deleteExpiredFiles,
  type FileDeletionJobDeps,
} from "./functions/delete-expired-files";
import {
  deleteOrphanFiles,
  type OrphanFileJobDeps,
} from "./functions/delete-orphan-files";
import {
  type ImportJobDeps,
  importDocument,
} from "./functions/import-document";
import { ping } from "./functions/ping";
import { type QuoteJobDeps, refreshQuotes } from "./functions/refresh-quotes";

export type {
  DueFile,
  FileDeletionJobDeps,
  FileDeletionStorePort,
} from "./functions/delete-expired-files";
export type {
  OrphanFile,
  OrphanFileJobDeps,
  OrphanFileStorePort,
} from "./functions/delete-orphan-files";
export type {
  ImportJobDeps,
  ImportStorePort,
  ImportToRead,
} from "./functions/import-document";
export type { QuoteJobDeps } from "./functions/refresh-quotes";
export { inngestJobRunner, type JobRunner } from "./job-runner";

const DEV_SERVE_ORIGIN = "http://127.0.0.1:3000";

const RUNS_JOBS = DEV_SERVER_MODE || process.env.PLANT_RUN_JOBS === "1";

// Options for the framework `serve()` in apps/web. Unauthenticated syncs stay
// off: an unsigned PUT would otherwise re-register the app with Inngest at a
// URL taken from the request's Host header. Syncs from the dashboard and the
// Vercel integration are signed, so they keep working. `satisfies` makes a
// misspelled option a type error instead of a silent default.
//
// refresh-quotes, import-document, delete-expired-files and
// delete-orphan-files register in dev-server mode, and on a deployment only
// where PLANT_RUN_JOBS is "1" (the one environment whose Supabase they may
// write); only then are their dependencies built. Dev mode checks no signature, so its registered URL is
// the loopback `next dev` binds, never the request's Host.
export function createServeOptions(opts: {
  quotes?: () => QuoteJobDeps;
  imports?: () => ImportJobDeps;
  files?: () => FileDeletionJobDeps;
  orphans?: () => OrphanFileJobDeps;
}) {
  return {
    client: inngest,
    functions: RUNS_JOBS
      ? [
          ping,
          ...(opts.quotes ? [refreshQuotes(opts.quotes())] : []),
          ...(opts.imports ? [importDocument(opts.imports())] : []),
          ...(opts.files ? [deleteExpiredFiles(opts.files())] : []),
          ...(opts.orphans ? [deleteOrphanFiles(opts.orphans())] : []),
        ]
      : [ping],
    enableUnauthedSync: false,
    ...(DEV_SERVER_MODE ? { serveOrigin: DEV_SERVE_ORIGIN } : {}),
  } satisfies ServeHandlerOptions;
}
