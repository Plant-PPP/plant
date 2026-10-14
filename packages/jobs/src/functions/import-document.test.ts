import { type ImportDraft, SourceError } from "@plant/sources";
import type { LogFields } from "@plant/shared";
import { NonRetriableError } from "inngest";

import {
  failAbandonedImport,
  type ImportJobDeps,
  type ImportSteps,
  runImportDocument,
} from "./import-document";

const USER = "a0000000-0000-4000-8000-00000000000a";
const IMPORT = "a1000000-0000-4000-8000-0000000000a1";
const PATH = `${USER}/imports/a9000000-0000-4000-8000-0000000000a9/a7000000-0000-4000-8000-0000000000a7`;
const BYTES = new TextEncoder().encode("%PDF-1.7");

const DRAFT: ImportDraft = {
  documentDate: "2026-09-30",
  rows: [
    {
      symbol: "AAPL",
      quantity: "5",
      price: "18000",
      value: "90000",
      currency: "ARS",
      confidence: "high",
      page: 1,
    },
  ],
  totals: [{ currency: "ARS", amount: "90000" }],
};
const READ = {
  reader: "document",
  mapping: "none",
  skippedRows: 0,
  disputes: 0,
} as const;

type Line = { level: string; event: string; fields: LogFields };

function setUp(overrides: Partial<ImportJobDeps> = {}) {
  const lines: Line[] = [];
  const log = (level: string) => (event: string, fields: LogFields) =>
    lines.push({ level, event, fields });
  const store = {
    load: jest.fn().mockResolvedValue({
      userId: USER,
      status: "queued",
      path: PATH,
      mimeType: "application/pdf",
    }),
    download: jest.fn().mockResolvedValue(BYTES),
    reading: jest.fn().mockResolvedValue(undefined),
    institution: jest.fn().mockResolvedValue("IOL"),
    saveDraft: jest.fn().mockResolvedValue(undefined),
    failed: jest.fn().mockResolvedValue(undefined),
  };
  const deps: ImportJobDeps = {
    store,
    extract: jest.fn().mockResolvedValue({ draft: DRAFT, read: READ }),
    log: { info: log("info"), warn: log("warn"), error: log("error") },
    ...overrides,
  };
  const ran: string[] = [];
  // Inngest retries a step that throws; here a throw ends it, as on the
  // last attempt.
  const step: ImportSteps = {
    run: async (id, fn) => {
      ran.push(id);
      return fn();
    },
  };
  const run = (userId = USER) =>
    runImportDocument(deps, {
      step,
      runId: "01M8Z3K4567890QWERTYXABCDE",
      attempt: 0,
      event: { data: { importId: IMPORT, userId } },
    });
  return { deps, store, lines, ran, run };
}

it("reads the file into a draft and marks the import ready", async () => {
  const { store, deps, lines, ran, run } = setUp();
  expect(await run()).toEqual({ outcome: "ready", rows: 1 });
  expect(ran).toEqual(["prepare", "read"]);
  expect(store.reading).toHaveBeenCalledWith(IMPORT, USER);
  expect(store.institution).toHaveBeenCalledWith(IMPORT, USER);
  expect(store.load).toHaveBeenCalledWith(IMPORT, USER);
  expect(store.download).toHaveBeenCalledWith(PATH);
  expect(deps.extract).toHaveBeenCalledWith({
    importId: IMPORT,
    bytes: BYTES,
    mimeType: "application/pdf",
    userId: USER,
    institution: "IOL",
    lastAttempt: false,
  });
  expect(store.saveDraft).toHaveBeenCalledWith(IMPORT, USER, DRAFT);
  expect(lines).toEqual([
    {
      level: "info",
      event: "imports.read",
      fields: expect.objectContaining({
        "plant.outcome": "ok",
        "plant.import.row_count": 1,
        "plant.import.reader": "document",
        "plant.import.mapping": "none",
        "plant.import.skipped_count": 0,
        "plant.import.dispute_count": 0,
        "plant.import.id": IMPORT,
      }),
    },
  ]);
  expect(JSON.stringify(lines)).not.toContain("AAPL");
  expect(JSON.stringify(lines)).not.toContain("IOL");
});

it("logs how many rows the reading skipped", async () => {
  const { lines, run } = setUp({
    extract: jest.fn().mockResolvedValue({
      draft: DRAFT,
      read: { reader: "sheet", mapping: "hit", skippedRows: 2, disputes: 0 },
    }),
  });
  await run();
  expect(lines[0]!.fields["plant.import.skipped_count"]).toBe(2);
});

it.each([
  ["another user's import", () => ({ userId: "b0" }), "missing"],
  ["one no longer queued", () => ({ status: "ready" }), "not_queued"],
  [
    "a file outside the user's folder",
    () => ({ path: `b0/imports/x/y` }),
    "path",
  ],
] as const)("skips %s and touches nothing", async (_, patch, reason) => {
  const { store, lines, run } = setUp();
  store.load.mockResolvedValue({
    userId: USER,
    status: "queued",
    path: PATH,
    mimeType: "application/pdf",
    ...patch(),
  });
  expect(await run()).toEqual({ outcome: "skipped" });
  expect(store.reading).not.toHaveBeenCalled();
  expect(store.download).not.toHaveBeenCalled();
  expect(lines[0]!.fields["plant.import.skip_reason"]).toBe(reason);
});

it("skips an import that does not exist", async () => {
  const { store, run } = setUp();
  store.load.mockResolvedValue(null);
  expect(await run()).toEqual({ outcome: "skipped" });
});

it.each([
  [
    "a type it does not read",
    new SourceError("unsupported", false),
    "unsupported",
  ],
  [
    "a reading that kept failing",
    new SourceError("extraction_failed", true),
    "extraction_failed",
  ],
  ["a bug", new Error("boom"), "extraction_failed"],
])("marks the import failed on %s", async (_, error, failure) => {
  const { store, run } = setUp({
    extract: jest.fn().mockRejectedValue(error),
  });
  expect(await run()).toEqual({ outcome: "failed" });
  expect(store.failed).toHaveBeenCalledWith(IMPORT, USER, failure);
  expect(store.saveDraft).not.toHaveBeenCalled();
});

it("fails an import whose file lists nothing", async () => {
  const { store, run } = setUp({
    extract: jest.fn().mockResolvedValue({
      draft: { documentDate: null, rows: [], totals: [] },
      read: READ,
    }),
  });
  expect(await run()).toEqual({ outcome: "failed" });
  expect(store.failed).toHaveBeenCalledWith(IMPORT, USER, "nothing_found");
});

it("does not retry a failure a retry would not pass", async () => {
  const thrown: unknown[] = [];
  const { deps } = setUp({
    extract: jest.fn().mockRejectedValue(new SourceError("unsupported", false)),
  });
  await runImportDocument(deps, {
    step: {
      run: async (id, fn) => {
        try {
          return await fn();
        } catch (error) {
          thrown.push(error);
          throw error;
        }
      },
    },
    runId: "r1",
    attempt: 0,
    event: { data: { importId: IMPORT, userId: USER } },
  });
  expect(thrown[0]).toBeInstanceOf(NonRetriableError);
});

it("lets a retryable failure reach the step, which retries it", async () => {
  const thrown: unknown[] = [];
  const { deps } = setUp({
    extract: jest
      .fn()
      .mockRejectedValue(new SourceError("extraction_failed", true)),
  });
  await runImportDocument(deps, {
    step: {
      run: async (id, fn) => {
        try {
          return await fn();
        } catch (error) {
          thrown.push(error);
          throw error;
        }
      },
    },
    runId: "r1",
    attempt: 0,
    event: { data: { importId: IMPORT, userId: USER } },
  });
  expect(thrown[0]).toBeInstanceOf(SourceError);
});

// The engine hands a failed step back rebuilt from JSON: a plain Error with
// the original's name and message, its class and code gone.
const rebuilt = (error: unknown) => {
  const { name, message } = error as Error;
  return Object.assign(new Error(message), { name });
};

it.each([
  ["a NonRetriableError", new SourceError("unsupported", false), "unsupported"],
  ["a retried SourceError", new SourceError("unreadable", true), "unreadable"],
  ["anything else", new Error("boom"), "extraction_failed"],
])(
  "keeps the failure's code when the engine rebuilds %s",
  async (_, error, failure) => {
    const { deps, store } = setUp({
      extract: jest.fn().mockRejectedValue(error),
    });
    await runImportDocument(deps, {
      step: {
        run: async (id, fn) => {
          try {
            return await fn();
          } catch (thrown) {
            throw rebuilt(thrown);
          }
        },
      },
      runId: "r1",
      attempt: 0,
      event: { data: { importId: IMPORT, userId: USER } },
    });
    expect(store.failed).toHaveBeenCalledWith(IMPORT, USER, failure);
  },
);

describe("an import whose run died past its retries", () => {
  it("is marked failed when it is still being read", async () => {
    const { deps, store, lines } = setUp();
    store.load.mockResolvedValue({
      userId: USER,
      status: "reading",
      path: PATH,
      mimeType: "application/pdf",
    });
    await failAbandonedImport(deps, { importId: IMPORT, userId: USER });
    expect(store.failed).toHaveBeenCalledWith(
      IMPORT,
      USER,
      "extraction_failed",
    );
    expect(lines[0]!.fields["error.type"]).toBe("function_failed");
  });

  it.each([
    ["one already read", { userId: USER, status: "ready" }],
    ["another user's", { userId: "b0", status: "reading" }],
  ])("leaves %s alone", async (_, found) => {
    const { deps, store } = setUp();
    store.load.mockResolvedValue({ ...found, path: PATH, mimeType: "x" });
    await failAbandonedImport(deps, { importId: IMPORT, userId: USER });
    expect(store.load).toHaveBeenCalledWith(IMPORT, USER);
    expect(store.failed).not.toHaveBeenCalled();
  });

  it("ignores an event without an import", async () => {
    const { deps, store, lines } = setUp();
    await failAbandonedImport(deps, {});
    expect(store.load).not.toHaveBeenCalled();
    expect(lines[0]!.fields["plant.import.skip_reason"]).toBe("no_import");
  });
});
