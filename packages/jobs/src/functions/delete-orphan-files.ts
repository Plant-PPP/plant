import { BUENOS_AIRES_TZ, type Logger } from "@plant/shared";
import { NonRetriableError } from "inngest";

import { inngest } from "../client";

// A Storage object of the imports bucket over a day old that no document
// points at. `id` is the object's own id, never a path.
export type OrphanFile = { id: string; path: string };

// Where the job finds orphan files and removes them; the composition root
// implements it with the service role. `orphans` returns them by id, after
// `after` when given. Removing a path that is already gone succeeds.
export interface OrphanFileStorePort {
  orphans(limit: number, after: string | null): Promise<OrphanFile[]>;
  remove(paths: readonly string[]): Promise<void>;
}

export type OrphanFileJobDeps = {
  store: OrphanFileStorePort;
  log: Logger;
};

// Once a day, after delete-expired-files.
export const DELETE_ORPHAN_FILES_CRON = `TZ=${BUENOS_AIRES_TZ} 50 3 * * *`;
export const ORPHAN_BATCH = 100;
// A run removes at most this many batches; the next day's run takes the rest.
export const MAX_ORPHAN_BATCHES = 20;

type Batch = { removed: number; last: string | null };

export type OrphanFileSteps = {
  run(id: string, fn: () => Promise<Batch>): Promise<Batch>;
};

type RunContext = { step: OrphanFileSteps; runId: string };

// Removes orphan files a batch at a time, each batch after the last object
// id of the one before. A batch's step returns only a count and that id:
// paths never cross a step boundary.
export async function runDeleteOrphanFiles(
  deps: OrphanFileJobDeps,
  { step, runId }: RunContext,
): Promise<{ deleted: number }> {
  let deleted = 0;
  let after: string | null = null;
  let more = true;
  try {
    for (let batch = 0; more && batch < MAX_ORPHAN_BATCHES; batch += 1) {
      const cursor = after;
      const done: Batch = await step.run(`batch-${batch}`, async () => {
        const found = await deps.store.orphans(ORPHAN_BATCH, cursor);
        if (found.length === 0) return { removed: 0, last: null };
        await deps.store.remove(found.map((file) => file.path));
        return { removed: found.length, last: found.at(-1)!.id };
      });
      deleted += done.removed;
      after = done.last;
      more = done.removed === ORPHAN_BATCH;
    }
  } catch (error) {
    deps.log.error(
      "imports.orphans_delete",
      {
        "plant.inngest.run_id": runId,
        "plant.outcome": "failed",
        "plant.import.file_count": deleted,
      },
      error,
    );
    throw new NonRetriableError("imports.orphans_delete failed");
  }
  deps.log.info("imports.orphans_delete", {
    "plant.inngest.run_id": runId,
    "plant.outcome": more ? "partial" : "ok",
    "plant.import.file_count": deleted,
  });
  return { deleted };
}

export const deleteOrphanFiles = (deps: OrphanFileJobDeps) =>
  inngest.createFunction(
    {
      id: "delete-orphan-files",
      triggers: [{ cron: DELETE_ORPHAN_FILES_CRON }],
      singleton: { mode: "skip" },
      retries: 2,
    },
    ({ step, runId }) => runDeleteOrphanFiles(deps, { step, runId }),
  );
