import type { LogFields } from "@plant/shared";
import { NonRetriableError } from "inngest";

import {
  DELETE_BATCH,
  type DueFile,
  type FileDeletionJobDeps,
  type FileDeletionSteps,
  MAX_BATCHES,
  runDeleteExpiredFiles,
} from "./delete-expired-files";

type Line = { level: string; event: string; fields: LogFields };

const files = (count: number, from = 0): DueFile[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `d${from + i}`,
    path: `u/imports/x/${from + i}`,
  }));

function setUp(
  batches: DueFile[][],
  overrides: Partial<FileDeletionJobDeps["store"]> = {},
) {
  const lines: Line[] = [];
  const log = (level: string) => (event: string, fields: LogFields) =>
    lines.push({ level, event, fields });
  const queue = [...batches];
  const store = {
    due: jest.fn(async () => queue.shift() ?? []),
    remove: jest.fn().mockResolvedValue(undefined),
    markDeleted: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  const deps: FileDeletionJobDeps = {
    store,
    log: { info: log("info"), warn: log("warn"), error: log("error") },
    now: () => new Date("2026-10-13T06:20:00Z"),
  };
  const ran: string[] = [];
  const step: FileDeletionSteps = {
    run: async (id, fn) => {
      ran.push(id);
      return fn();
    },
  };
  return { deps, store, lines, ran, step };
}

it("removes the due files and marks their rows", async () => {
  const { deps, store, lines, step } = setUp([files(2)]);
  expect(await runDeleteExpiredFiles(deps, { step, runId: "r1" })).toEqual({
    deleted: 2,
  });
  expect(store.remove).toHaveBeenCalledWith(["u/imports/x/0", "u/imports/x/1"]);
  expect(store.markDeleted).toHaveBeenCalledWith(["d0", "d1"], deps.now());
  expect(lines).toEqual([
    {
      level: "info",
      event: "imports.files_delete",
      fields: {
        "plant.inngest.run_id": "r1",
        "plant.outcome": "ok",
        "plant.import.file_count": 2,
      },
    },
  ]);
});

it("touches nothing when no file is due", async () => {
  const { deps, store, step } = setUp([]);
  expect(await runDeleteExpiredFiles(deps, { step, runId: "r1" })).toEqual({
    deleted: 0,
  });
  expect(store.remove).not.toHaveBeenCalled();
  expect(store.markDeleted).not.toHaveBeenCalled();
});

it("takes another batch while a batch comes back full", async () => {
  const { deps, ran, step } = setUp([
    files(DELETE_BATCH),
    files(3, DELETE_BATCH),
  ]);
  expect(await runDeleteExpiredFiles(deps, { step, runId: "r1" })).toEqual({
    deleted: DELETE_BATCH + 3,
  });
  expect(ran).toEqual(["batch-0", "batch-1"]);
});

it("stops after its last batch and leaves the rest for the next run", async () => {
  const full = Array.from({ length: MAX_BATCHES + 1 }, (_, i) =>
    files(DELETE_BATCH, i * DELETE_BATCH),
  );
  const { deps, lines, ran, step } = setUp(full);
  await runDeleteExpiredFiles(deps, { step, runId: "r1" });
  expect(ran).toHaveLength(MAX_BATCHES);
  expect(lines[0]!.fields["plant.outcome"]).toBe("partial");
});

it("does not mark a row whose file it could not remove", async () => {
  const { deps, store, lines, step } = setUp([files(1)], {
    remove: jest.fn().mockRejectedValue(new Error("storage down")),
  });
  await expect(
    runDeleteExpiredFiles(deps, { step, runId: "r1" }),
  ).rejects.toBeInstanceOf(NonRetriableError);
  expect(store.markDeleted).not.toHaveBeenCalled();
  expect(lines[0]).toMatchObject({
    level: "error",
    fields: { "plant.outcome": "failed", "plant.import.file_count": 0 },
  });
});

it("never logs a path or an id", async () => {
  const { deps, lines, step } = setUp([files(1)]);
  await runDeleteExpiredFiles(deps, { step, runId: "r1" });
  expect(JSON.stringify(lines)).not.toMatch(/imports\/x|"d0"/);
});
