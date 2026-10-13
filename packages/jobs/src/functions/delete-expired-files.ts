import { BUENOS_AIRES_TZ, type Logger } from "@plant/shared";
import { NonRetriableError } from "inngest";

import { inngest } from "../client";

// An uploaded file past its delete_after, still in Storage.
export type DueFile = { id: string; path: string };

// Where the job finds due files, removes them and marks their rows; the
// composition root implements it with the service role. Removing a path that
// is already gone succeeds.
export interface FileDeletionStorePort {
  due(now: Date, limit: number): Promise<DueFile[]>;
  remove(paths: readonly string[]): Promise<void>;
  markDeleted(ids: readonly string[], at: Date): Promise<void>;
}

export type FileDeletionJobDeps = {
  store: FileDeletionStorePort;
  log: Logger;
  now: () => Date;
};

// Once a day, at night in Buenos Aires.
export const DELETE_EXPIRED_FILES_CRON = `TZ=${BUENOS_AIRES_TZ} 20 3 * * *`;
export const DELETE_BATCH = 100;
// A run removes at most this many batches; the next day's run takes the rest.
export const MAX_BATCHES = 20;

export type FileDeletionSteps = {
  run(id: string, fn: () => Promise<number>): Promise<number>;
};

type RunContext = { step: FileDeletionSteps; runId: string };

// Removes due files a batch at a time. A batch's step returns only how many
// it removed: paths never cross a step boundary.
export async function runDeleteExpiredFiles(
  deps: FileDeletionJobDeps,
  { step, runId }: RunContext,
): Promise<{ deleted: number }> {
  let deleted = 0;
  let more = true;
  try {
    for (let batch = 0; more && batch < MAX_BATCHES; batch += 1) {
      const removed = await step.run(`batch-${batch}`, async () => {
        const due = await deps.store.due(deps.now(), DELETE_BATCH);
        if (due.length === 0) return 0;
        await deps.store.remove(due.map((file) => file.path));
        await deps.store.markDeleted(
          due.map((file) => file.id),
          deps.now(),
        );
        return due.length;
      });
      deleted += removed;
      more = removed === DELETE_BATCH;
    }
  } catch (error) {
    deps.log.error(
      "imports.files_delete",
      {
        "plant.inngest.run_id": runId,
        "plant.outcome": "failed",
        "plant.import.file_count": deleted,
      },
      error,
    );
    throw new NonRetriableError("imports.files_delete failed");
  }
  deps.log.info("imports.files_delete", {
    "plant.inngest.run_id": runId,
    "plant.outcome": more ? "partial" : "ok",
    "plant.import.file_count": deleted,
  });
  return { deleted };
}

export const deleteExpiredFiles = (deps: FileDeletionJobDeps) =>
  inngest.createFunction(
    {
      id: "delete-expired-files",
      triggers: [{ cron: DELETE_EXPIRED_FILES_CRON }],
      singleton: { mode: "skip" },
      retries: 2,
    },
    ({ step, runId }) => runDeleteExpiredFiles(deps, { step, runId }),
  );
