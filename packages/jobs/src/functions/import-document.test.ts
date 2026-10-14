import {
  CONNECTION_PROVIDERS,
  type ConnectionAdapters,
  type ConnectionProviderPort,
  type ImportDraft,
  type PortfolioSourcePort,
  SourceError,
} from "@plant/sources";
import type { LogFields } from "@plant/shared";
import { NonRetriableError, serializeError } from "inngest";

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
const ACCOUNT = "a2000000-0000-4000-8000-0000000000a2";
// Made up.
const CREDENTIALS = {
  apiKey: "KeyKeyKeyKey0001",
  apiSecret: "SecretSecret0001",
};
const SYNC = {
  userId: USER,
  status: "queued",
  origin: "connection",
  draft: "holdings",
  accountId: ACCOUNT,
  provider: "binance",
  period: { from: null, to: null },
} as const;

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
  documentKind: "account_statement",
} as const;

type Line = { level: string; event: string; fields: LogFields };

function setUp({
  read = jest.fn().mockResolvedValue({ draft: DRAFT, read: READ }),
  exchangeRead = jest
    .fn()
    .mockResolvedValue({ draft: DRAFT, read: { ...READ, reader: "api" } }),
  ...overrides
}: Partial<Omit<ImportJobDeps, "source" | "connections">> & {
  read?: PortfolioSourcePort["read"];
  exchangeRead?: ConnectionProviderPort["read"];
} = {}) {
  const lines: Line[] = [];
  const log = (level: string) => (event: string, fields: LogFields) =>
    lines.push({ level, event, fields });
  const store = {
    load: jest.fn().mockResolvedValue({
      userId: USER,
      status: "queued",
      origin: "file",
      path: PATH,
      mimeType: "application/pdf",
    }),
    download: jest.fn().mockResolvedValue(BYTES),
    reading: jest.fn().mockResolvedValue(undefined),
    institution: jest.fn().mockResolvedValue("IOL"),
    credentials: jest.fn().mockResolvedValue(CREDENTIALS),
    saveDraft: jest.fn().mockResolvedValue(true),
    saveOperations: jest.fn().mockResolvedValue(true),
    saveDebts: jest.fn().mockResolvedValue(true),
    failed: jest.fn().mockResolvedValue(undefined),
  };
  const deps: ImportJobDeps = {
    store,
    source: {
      kind: "file_upload",
      capabilities: () => ({
        holdings: "native",
        movements: "unsupported",
        incremental: "unsupported",
      }),
      read,
    },
    connections: Object.fromEntries(
      CONNECTION_PROVIDERS.map((provider) => [
        provider,
        () => ({
          provider,
          fields: [],
          hintField: "apiKey",
          readOnly: "checked",
          drafts: ["holdings", "operations"],
          parse: (raw: unknown) => raw as Record<string, string>,
          check: jest.fn(),
          read: exchangeRead,
        }),
      ]),
    ) as unknown as ConnectionAdapters,
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

it("saves a document of operations as operations", async () => {
  const operations = [
    {
      date: null,
      kind: "purchase" as const,
      symbol: null,
      quantity: "1",
      price: null,
      amount: null,
      charges: null,
      reference: null,
      currency: "ARS" as const,
      confidence: "low" as const,
      page: null,
    },
  ];
  const { store, lines, run } = setUp({
    read: jest.fn().mockResolvedValue({
      operations,
      read: { ...READ, documentKind: "trade_ticket" },
    }),
  });
  expect(await run()).toEqual({ outcome: "ready", rows: 1 });
  expect(store.saveOperations).toHaveBeenCalledWith(IMPORT, USER, operations);
  expect(store.saveDraft).not.toHaveBeenCalled();
  expect(lines[0]!.fields).toMatchObject({
    "plant.import.draft": "operations",
    "plant.import.document_kind": "trade_ticket",
  });
});

it("saves a card statement as debts", async () => {
  const debts = [
    {
      label: "Visa",
      lender: null,
      currency: "ARS" as const,
      balance: "1000",
      minimumPayment: null,
      dueDate: null,
      confidence: "high" as const,
      page: 1,
    },
  ];
  const { store, lines, run } = setUp({
    read: jest.fn().mockResolvedValue({
      debts,
      read: { ...READ, documentKind: "card_statement" },
    }),
  });
  expect(await run()).toEqual({ outcome: "ready", rows: 1 });
  expect(store.saveDebts).toHaveBeenCalledWith(IMPORT, USER, debts);
  expect(store.saveDraft).not.toHaveBeenCalled();
  expect(lines[0]!.fields).toMatchObject({
    "plant.import.draft": "debts",
    "plant.import.document_kind": "card_statement",
  });
});

it.each(["saveDraft", "saveOperations", "saveDebts"] as const)(
  "skips an import gone from being read before %s wrote",
  async (save) => {
    const result =
      save === "saveOperations"
        ? { operations: [{}], read: READ }
        : save === "saveDebts"
          ? { debts: [{}], read: READ }
          : { draft: DRAFT, read: READ };
    const { store, lines, run } = setUp({
      read: jest.fn().mockResolvedValue(result),
    });
    store[save].mockResolvedValue(false);
    expect(await run()).toEqual({ outcome: "skipped" });
    expect(store.failed).not.toHaveBeenCalled();
    expect(lines).toEqual([
      {
        level: "warn",
        event: "imports.read",
        fields: expect.objectContaining({
          "plant.outcome": "skipped",
          "plant.import.skip_reason": "gone",
          "plant.import.id": IMPORT,
        }),
      },
    ]);
  },
);

it("finds nothing in a document of no operations", async () => {
  const { store, run } = setUp({
    read: jest.fn().mockResolvedValue({ operations: [], read: READ }),
  });
  expect(await run()).toEqual({ outcome: "failed" });
  expect(store.failed).toHaveBeenCalledWith(IMPORT, USER, "nothing_found");
});

it("reads the file into a draft and marks the import ready", async () => {
  const { store, deps, lines, ran, run } = setUp();
  expect(await run()).toEqual({ outcome: "ready", rows: 1 });
  expect(ran).toEqual(["prepare", "read"]);
  expect(store.reading).toHaveBeenCalledWith(IMPORT, USER);
  expect(store.institution).toHaveBeenCalledWith(IMPORT, USER);
  expect(store.load).toHaveBeenCalledWith(IMPORT, USER);
  expect(store.download).toHaveBeenCalledWith(PATH);
  expect(deps.source.read).toHaveBeenCalledWith({
    importId: IMPORT,
    bytes: BYTES,
    mimeType: "application/pdf",
    userId: USER,
    institution: "IOL",
    lastAttempt: false,
  });
  expect(store.saveDraft).toHaveBeenCalledWith(IMPORT, USER, DRAFT, 0);
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
    read: jest.fn().mockResolvedValue({
      draft: DRAFT,
      read: {
        reader: "sheet",
        mapping: "hit",
        skippedRows: 2,
        disputes: 0,
        documentKind: null,
      },
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
    read: jest.fn().mockRejectedValue(error),
  });
  expect(await run()).toEqual({ outcome: "failed" });
  expect(store.failed).toHaveBeenCalledWith(IMPORT, USER, failure);
  expect(store.saveDraft).not.toHaveBeenCalled();
});

it("fails an import whose file lists nothing", async () => {
  const { store, run } = setUp({
    read: jest.fn().mockResolvedValue({
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
    read: jest.fn().mockRejectedValue(new SourceError("unsupported", false)),
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
    read: jest
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
      read: jest.fn().mockRejectedValue(error),
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

// The model's raw answer rides on the AI SDK's errors, below a SourceError's
// cause.
const leaky = new Error("Type validation failed: SECRET_ROW");

it.each([
  [
    "a failure a retry would not pass",
    new SourceError("unreadable", false, { cause: leaky }),
  ],
  [
    "a retryable failure",
    new SourceError("extraction_failed", true, { cause: leaky }),
  ],
  ["anything else", new Error("boom", { cause: leaky })],
])(
  "keeps the cause of %s out of what the step hands the engine",
  async (_, error) => {
    const thrown: unknown[] = [];
    const { deps } = setUp({ read: jest.fn().mockRejectedValue(error) });
    await runImportDocument(deps, {
      step: {
        run: async (id, fn) => {
          try {
            return await fn();
          } catch (caught) {
            thrown.push(caught);
            throw caught;
          }
        },
      },
      runId: "r1",
      attempt: 0,
      event: { data: { importId: IMPORT, userId: USER } },
    });
    expect(thrown).toHaveLength(1);
    expect(JSON.stringify(serializeError(thrown[0] as Error))).not.toContain(
      "SECRET_ROW",
    );
  },
);

// What the composition root's store throws.
class ImportStoreError extends Error {
  override readonly name = "ImportStoreError";
  constructor(
    readonly step: string,
    readonly code: string,
  ) {
    super(`import store ${step} failed: ${code}`);
  }
}

it.each([
  ["as thrown", (error: unknown) => error],
  ["once the engine rebuilds it", rebuilt],
])(
  "logs a store that kept failing as an error with its step and code, %s",
  async (_, engine) => {
    const { store, lines, deps } = setUp();
    store.saveDraft.mockRejectedValue(new ImportStoreError("draft", "42501"));
    expect(
      await runImportDocument(deps, {
        step: {
          run: async (id, fn) => {
            try {
              return await fn();
            } catch (thrown) {
              throw engine(thrown);
            }
          },
        },
        runId: "r1",
        attempt: 0,
        event: { data: { importId: IMPORT, userId: USER } },
      }),
    ).toEqual({ outcome: "failed" });
    expect(store.failed).toHaveBeenCalledWith(
      IMPORT,
      USER,
      "extraction_failed",
    );
    expect(lines).toEqual([
      {
        level: "error",
        event: "imports.read",
        fields: expect.objectContaining({
          "plant.outcome": "failed",
          "error.type": "extraction_failed",
          "plant.import.store_step": "draft",
          "plant.import.store_code": "42501",
        }),
      },
    ]);
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

describe("a sync", () => {
  it("reads the account's balances with its key into a draft and never touches a file", async () => {
    const exchangeRead = jest
      .fn()
      .mockResolvedValue({ draft: DRAFT, read: { ...READ, reader: "api" } });
    const { store, lines, ran, run } = setUp({ exchangeRead });
    store.load.mockResolvedValue(SYNC);
    expect(await run()).toEqual({ outcome: "ready", rows: 1 });
    expect(store.reading).toHaveBeenCalledWith(IMPORT, USER);
    expect(store.credentials).toHaveBeenCalledWith(USER, ACCOUNT, "binance");
    expect(exchangeRead).toHaveBeenCalledWith(CREDENTIALS, "holdings", {
      from: null,
      to: null,
    });
    expect(store.saveDraft).toHaveBeenCalledWith(IMPORT, USER, DRAFT, 0);
    expect(store.download).not.toHaveBeenCalled();
    expect(store.institution).not.toHaveBeenCalled();
    expect(ran).toEqual(["prepare", "read"]);
    expect(lines[0]!.fields["plant.import.reader"]).toBe("api");
  });

  it("keeps the key out of every step's output and every log line", async () => {
    const { deps, store, lines } = setUp();
    store.load.mockResolvedValue(SYNC);
    const outputs: unknown[] = [];
    await runImportDocument(deps, {
      step: {
        run: async (_, fn) => {
          const output = await fn();
          outputs.push(output);
          return output;
        },
      },
      runId: "01M8Z3K4567890QWERTYXABCDE",
      attempt: 0,
      event: { data: { importId: IMPORT, userId: USER } },
    });
    const seen = JSON.stringify([outputs, lines]);
    expect(seen).not.toContain(CREDENTIALS.apiKey);
    expect(seen).not.toContain(CREDENTIALS.apiSecret);
  });

  it.each([
    ["the key can trade", "connection_not_read_only"],
    ["the exchange refuses the key", "connection_rejected"],
  ] as const)("fails when %s, without retrying", async (_, code) => {
    const { store, run } = setUp({
      exchangeRead: jest.fn().mockRejectedValue(new SourceError(code, false)),
    });
    store.load.mockResolvedValue(SYNC);
    expect(await run()).toEqual({ outcome: "failed" });
    expect(store.failed).toHaveBeenCalledWith(IMPORT, USER, code);
    expect(store.saveDraft).not.toHaveBeenCalled();
  });

  it("fails as rejected when the account holds no key any more", async () => {
    const exchangeRead = jest.fn();
    const { store, run } = setUp({ exchangeRead });
    store.load.mockResolvedValue(SYNC);
    store.credentials.mockResolvedValue(null);
    expect(await run()).toEqual({ outcome: "failed" });
    expect(exchangeRead).not.toHaveBeenCalled();
    expect(store.failed).toHaveBeenCalledWith(
      IMPORT,
      USER,
      "connection_rejected",
    );
  });

  it("finds nothing in an account with no balances", async () => {
    const { store, run } = setUp({
      exchangeRead: jest.fn().mockResolvedValue({
        draft: { documentDate: "2026-10-14", rows: [], totals: [] },
        read: { ...READ, reader: "api" },
      }),
    });
    store.load.mockResolvedValue(SYNC);
    expect(await run()).toEqual({ outcome: "failed" });
    expect(store.failed).toHaveBeenCalledWith(IMPORT, USER, "nothing_found");
  });

  it("reads a sync of operations into a draft of operations", async () => {
    const operations = [
      {
        date: "2026-10-01",
        kind: "purchase" as const,
        symbol: "AAPL",
        quantity: "1",
        price: null,
        amount: "100",
        charges: null,
        reference: null,
        currency: "USD" as const,
        confidence: "medium" as const,
        page: null,
      },
    ];
    const exchangeRead = jest
      .fn()
      .mockResolvedValue({ operations, read: { ...READ, reader: "api" } });
    const { store, run } = setUp({ exchangeRead });
    const period = { from: "2026-01-01", to: "2026-06-30" };
    store.load.mockResolvedValue({
      ...SYNC,
      provider: "wallbit",
      draft: "operations",
      period,
    });
    expect(await run()).toEqual({ outcome: "ready", rows: 1 });
    expect(exchangeRead).toHaveBeenCalledWith(
      CREDENTIALS,
      "operations",
      period,
    );
    expect(store.credentials).toHaveBeenCalledWith(USER, ACCOUNT, "wallbit");
    expect(store.saveOperations).toHaveBeenCalledWith(IMPORT, USER, operations);
  });

  it("skips another user's sync without reading a key", async () => {
    const { store, run } = setUp();
    store.load.mockResolvedValue({ ...SYNC, userId: "b0" });
    expect(await run()).toEqual({ outcome: "skipped" });
    expect(store.credentials).not.toHaveBeenCalled();
  });
});
