import type { LogFields } from "@plant/shared";
import { NonRetriableError } from "inngest";

import {
  MAX_ORPHAN_BATCHES,
  ORPHAN_BATCH,
  type OrphanFile,
  type OrphanFileJobDeps,
  type OrphanFileSteps,
  runDeleteOrphanFiles,
} from "./delete-orphan-files";

type Line = { level: string; event: string; fields: LogFields };

const files = (count: number, from = 0): OrphanFile[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `o${from + i}`,
    path: `u/imports/mi-resumen-${from + i}.pdf`,
  }));

function setUp(
  batches: OrphanFile[][],
  overrides: Partial<OrphanFileJobDeps["store"]> = {},
) {
  const lines: Line[] = [];
  const log = (level: string) => (event: string, fields: LogFields) =>
    lines.push({ level, event, fields });
  const queue = [...batches];
  const orphans = jest.fn<
    Promise<OrphanFile[]>,
    [limit: number, after: string | null]
  >(async () => queue.shift() ?? []);
  const store = {
    orphans,
    remove: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  const deps: OrphanFileJobDeps = {
    store,
    log: { info: log("info"), warn: log("warn"), error: log("error") },
  };
  const ran: string[] = [];
  const returned: unknown[] = [];
  const step: OrphanFileSteps = {
    run: async (id, fn) => {
      ran.push(id);
      const out = await fn();
      returned.push(out);
      return out;
    },
  };
  return { deps, store, orphans, lines, ran, returned, step };
}

it("removes the orphan files and logs how many", async () => {
  const { deps, store, lines, step } = setUp([files(2)]);
  expect(await runDeleteOrphanFiles(deps, { step, runId: "r1" })).toEqual({
    deleted: 2,
  });
  expect(store.orphans).toHaveBeenCalledWith(ORPHAN_BATCH, null);
  expect(store.remove).toHaveBeenCalledWith([
    "u/imports/mi-resumen-0.pdf",
    "u/imports/mi-resumen-1.pdf",
  ]);
  expect(lines).toEqual([
    {
      level: "info",
      event: "imports.orphans_delete",
      fields: {
        "plant.inngest.run_id": "r1",
        "plant.outcome": "ok",
        "plant.import.file_count": 2,
      },
    },
  ]);
});

it("removes nothing when there is no orphan", async () => {
  const { deps, store, step } = setUp([]);
  expect(await runDeleteOrphanFiles(deps, { step, runId: "r1" })).toEqual({
    deleted: 0,
  });
  expect(store.remove).not.toHaveBeenCalled();
});

it("takes the next batch after the last id while a batch comes back full", async () => {
  const { deps, orphans, ran, step } = setUp([
    files(ORPHAN_BATCH),
    files(3, ORPHAN_BATCH),
  ]);
  expect(await runDeleteOrphanFiles(deps, { step, runId: "r1" })).toEqual({
    deleted: ORPHAN_BATCH + 3,
  });
  expect(ran).toEqual(["batch-0", "batch-1"]);
  expect(orphans.mock.calls).toEqual([
    [ORPHAN_BATCH, null],
    [ORPHAN_BATCH, `o${ORPHAN_BATCH - 1}`],
  ]);
});

it("stops after its last batch and leaves the rest for the next run", async () => {
  const full = Array.from({ length: MAX_ORPHAN_BATCHES + 1 }, (_, i) =>
    files(ORPHAN_BATCH, i * ORPHAN_BATCH),
  );
  const { deps, lines, ran, step } = setUp(full);
  expect(await runDeleteOrphanFiles(deps, { step, runId: "r1" })).toEqual({
    deleted: MAX_ORPHAN_BATCHES * ORPHAN_BATCH,
  });
  expect(ran).toHaveLength(MAX_ORPHAN_BATCHES);
  expect(lines[0]!.fields["plant.outcome"]).toBe("partial");
});

it("fails, logging what it removed before the batch that failed", async () => {
  const { deps, lines, step } = setUp([files(ORPHAN_BATCH), files(1, 100)], {
    remove: jest
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValue(new Error("storage down")),
  });
  await expect(
    runDeleteOrphanFiles(deps, { step, runId: "r1" }),
  ).rejects.toBeInstanceOf(NonRetriableError);
  expect(lines[0]).toMatchObject({
    level: "error",
    event: "imports.orphans_delete",
    fields: {
      "plant.outcome": "failed",
      "plant.import.file_count": ORPHAN_BATCH,
    },
  });
});

it("never logs a path, nor returns one from a step", async () => {
  const { deps, lines, returned, step } = setUp([files(1)]);
  await runDeleteOrphanFiles(deps, { step, runId: "r1" });
  expect(JSON.stringify(lines)).not.toMatch(/mi-resumen|"o0"/);
  expect(JSON.stringify(returned)).not.toMatch(/mi-resumen/);
});
