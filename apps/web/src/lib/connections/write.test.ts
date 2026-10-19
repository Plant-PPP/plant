jest.mock("server-only", () => ({}), { virtual: true });
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/lib/auth/session-claims", () => ({
  getSessionClaims: async () => ({ sub: mockSessionUser.id }),
}));
jest.mock("@/lib/request-id-server", () => ({
  currentRequestId: async () => undefined,
}));
const startImport = jest.fn();
jest.mock("@plant/jobs", () => ({
  inngestJobRunner: () => ({ startImport }),
}));

type Answer = { data?: unknown; error?: unknown; status: number };
const answers: Record<string, jest.Mock<Answer, [string]>> = {};
const answer = (fn: (verb: string) => Answer) => jest.fn<Answer, [string]>(fn);
const writes: {
  table: string;
  verb: string;
  body?: unknown;
  filters: [string, unknown][];
}[] = [];
const rpcs: { name: string; args: unknown }[] = [];
let rpcAnswer: (name: string) => Answer = () => ({ status: 404 });
jest.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc: async (name: string, args: unknown) => {
      rpcs.push({ name, args });
      return rpcAnswer(name);
    },
    from: (table: string) => {
      let verb = "select";
      const filters: [string, unknown][] = [];
      const builder = {
        select: () => builder,
        insert: (body: unknown) => {
          verb = "insert";
          writes.push({ table, verb, body, filters });
          return builder;
        },
        update: (body: unknown) => {
          verb = "update";
          writes.push({ table, verb, body, filters });
          return builder;
        },
        delete: () => {
          verb = "delete";
          writes.push({ table, verb, filters });
          return builder;
        },
        in: () => builder,
        eq: (column: string, value: unknown) => {
          filters.push([column, value]);
          return builder;
        },
        neq: () => builder,
        or: () => builder,
        is: () => builder,
        order: () => builder,
        limit: () => builder,
        then: (resolve: (value: unknown) => unknown) =>
          resolve(answers[table]!(verb)),
      };
      return builder;
    },
  }),
}));

const USER = "a0000000-0000-4000-8000-00000000000a";
const mockSessionUser = { id: USER };
const ACCOUNT = "a5000000-0000-4000-8000-0000000000a5";

import {
  type ConnectionAdapters,
  connectionAdapters,
  SourceError,
} from "@plant/sources";

import { CONSENT_VERSION } from "@/lib/consent";
import { captureServerLog } from "@/lib/log/capture-server-log";

import {
  connectApiKey,
  credentialsBytes,
  disconnectApiKey,
  readApiKey,
  syncAccount,
} from "./write";

// Made up.
const CREDENTIALS = {
  apiKey: "MadeUpApiKey00000000WXYZ",
  apiSecret: "MadeUpSecret0000000000001",
};
const INPUT = {
  accountId: ACCOUNT,
  provider: "binance",
  credentials: CREDENTIALS,
  confirmedReadOnly: false,
};

// The real adapters' metadata and parsing, with their calls faked.
const checkReadOnly = jest.fn();
const real = connectionAdapters();
const adapters = Object.fromEntries(
  Object.entries(real).map(([provider, make]) => [
    provider,
    () => ({ ...make(), check: checkReadOnly, read: jest.fn() }),
  ]),
) as unknown as ConnectionAdapters;

let lines: Record<string, unknown>[];
// Each test starts a fresh minute of the connect limiter.
let clock = 0;
beforeEach(() => {
  clock += 120_000;
  jest.spyOn(Date, "now").mockReturnValue(clock);
  lines = captureServerLog();
  mockSessionUser.id = USER;
  writes.length = 0;
  rpcs.length = 0;
  rpcAnswer = () => ({ status: 404 });
  checkReadOnly.mockReset().mockResolvedValue(undefined);
  startImport.mockReset().mockResolvedValue(undefined);
  answers.source_connections = answer(() => ({
    status: 200,
    data: [{ institution: "Binance" }],
    error: null,
  }));
  // No key yet: a replace changes no row.
  answers.account_api_keys = answer((verb) =>
    verb === "insert"
      ? { status: 201, error: null }
      : verb === "delete"
        ? { status: 204, error: null }
        : verb === "update"
          ? { status: 200, data: [], error: null }
          : { status: 200, data: [{ provider: "binance" }], error: null },
  );
  answers.consents = answer(() => ({
    status: 200,
    data: [{ version: CONSENT_VERSION, granted: true }],
    error: null,
  }));
  // No sync in flight.
  answers.imports = answer((verb) =>
    verb === "insert"
      ? { status: 201, data: [{ id: "i1" }], error: null }
      : { status: 200, data: [], error: null },
  );
});

const keyWrites = () =>
  writes.filter((each) => each.table === "account_api_keys");

afterEach(() => {
  jest.restoreAllMocks();
});

const logged = () => JSON.stringify(lines);

it("measures credentials as Postgres prints their jsonb", () => {
  expect(credentialsBytes({ a: "b", c: "d" })).toBe(
    '{"a": "b", "c": "d"}'.length,
  );
  expect(credentialsBytes({ a: "ñ" })).toBe('{"a": "ñ"}'.length + 1);
});

describe("connectApiKey", () => {
  it("asks the provider first, then hands the credentials to the database for Vault", async () => {
    expect(await connectApiKey(INPUT, adapters)).toEqual({ ok: true });
    expect(checkReadOnly).toHaveBeenCalledWith(CREDENTIALS);
    const insert = writes.find(
      (each) => each.table === "account_api_keys" && each.verb === "insert",
    );
    const body = insert!.body as Record<string, string>;
    expect(body).toMatchObject({
      source_connection_id: ACCOUNT,
      provider: "binance",
      key_hint: "WXYZ",
    });
    expect(Object.keys(body).sort()).toEqual([
      "credentials",
      "key_hint",
      "provider",
      "source_connection_id",
    ]);
    expect(body.credentials).toEqual(CREDENTIALS);
    // With no key to replace, it inserts; nothing is ever deleted.
    expect(keyWrites().map((each) => each.verb)).toEqual(["update", "insert"]);
    expect(logged()).not.toContain(CREDENTIALS.apiSecret);
    expect(logged()).not.toContain(CREDENTIALS.apiKey);
  });

  it("replaces the account's key in one write, only the user's on that account", async () => {
    answers.account_api_keys!.mockImplementation((verb) =>
      verb === "update"
        ? { status: 200, data: [{ id: "k1" }], error: null }
        : { status: 500, error: { code: "XX000" } },
    );
    expect(await connectApiKey(INPUT, adapters)).toEqual({ ok: true });
    const [replaced, ...rest] = keyWrites();
    expect(rest).toEqual([]);
    expect(replaced).toMatchObject({
      verb: "update",
      filters: [
        ["user_id", USER],
        ["source_connection_id", ACCOUNT],
      ],
    });
    expect(Object.keys(replaced!.body as object).sort()).toEqual([
      "credentials",
      "key_hint",
      "provider",
    ]);
  });

  it("keeps the old key when storing the new one fails", async () => {
    answers.account_api_keys!.mockImplementation(() => ({
      status: 500,
      error: { code: "XX000" },
    }));
    expect(await connectApiKey(INPUT, adapters)).toEqual({
      ok: false,
      code: "failed",
    });
    expect(keyWrites().map((each) => each.verb)).not.toContain("delete");
  });

  it("replaces the key that won a race to insert first", async () => {
    let updates = 0;
    answers.account_api_keys!.mockImplementation((verb) =>
      verb === "update"
        ? {
            status: 200,
            data: (updates += 1) === 1 ? [] : [{ id: "k1" }],
            error: null,
          }
        : { status: 409, error: { code: "23505" } },
    );
    expect(await connectApiKey(INPUT, adapters)).toEqual({ ok: true });
    expect(keyWrites().map((each) => each.verb)).toEqual([
      "update",
      "insert",
      "update",
    ]);
  });

  it("refuses a key for an account at another institution, asking nobody", async () => {
    answers.source_connections = answer(() => ({
      status: 200,
      data: [{ institution: "IOL" }],
      error: null,
    }));
    expect(await connectApiKey(INPUT, adapters)).toEqual({
      ok: false,
      code: "unsupported",
    });
    expect(checkReadOnly).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
  });

  it.each([
    ["connection_not_read_only", "not_read_only"],
    ["connection_rejected", "rejected"],
    ["extraction_failed", "unavailable"],
  ] as const)(
    "refuses a key the exchange answers %s for, storing nothing",
    async (failure, code) => {
      checkReadOnly.mockRejectedValue(
        new SourceError(failure, failure === "extraction_failed"),
      );
      expect(await connectApiKey(INPUT, adapters)).toEqual({ ok: false, code });
      expect(writes).toEqual([]);
      expect(logged()).not.toContain(CREDENTIALS.apiSecret);
    },
  );

  it.each([
    { ...INPUT, credentials: { ...CREDENTIALS, apiSecret: "short" } },
    {
      ...INPUT,
      credentials: { ...CREDENTIALS, apiKey: "with spaces 0000000" },
    },
    { ...INPUT, credentials: { apiKey: CREDENTIALS.apiKey } },
    { ...INPUT, credentials: { ...CREDENTIALS, extra: "x" } },
    { ...INPUT, provider: "other" },
    { ...INPUT, confirmedReadOnly: undefined },
    { ...INPUT, accountId: "not-a-uuid" },
    { ...INPUT, extra: true },
    // Each value fits, the object does not fit what the database takes.
    {
      ...INPUT,
      credentials: { apiKey: "A".repeat(2100), apiSecret: "B".repeat(2100) },
    },
  ])("refuses input that does not parse, asking nobody", async (input) => {
    expect(await connectApiKey(input, adapters)).toEqual({
      ok: false,
      code: "invalid",
    });
    expect(checkReadOnly).not.toHaveBeenCalled();
  });

  it("refuses an account the user does not have open", async () => {
    answers.source_connections = answer(() => ({
      status: 200,
      data: [],
      error: null,
    }));
    expect(await connectApiKey(INPUT, adapters)).toEqual({
      ok: false,
      code: "not_found",
    });
    expect(checkReadOnly).not.toHaveBeenCalled();
  });

  it("asks the user to confirm read-only where the provider does not say", async () => {
    answers.source_connections = answer(() => ({
      status: 200,
      data: [{ institution: "Wallbit" }],
      error: null,
    }));
    const wallbit = {
      accountId: ACCOUNT,
      provider: "wallbit",
      credentials: { apiKey: "wb_test_0000000000000001" },
    };
    expect(
      await connectApiKey({ ...wallbit, confirmedReadOnly: false }, adapters),
    ).toEqual({ ok: false, code: "unconfirmed" });
    expect(checkReadOnly).not.toHaveBeenCalled();
    expect(
      await connectApiKey({ ...wallbit, confirmedReadOnly: true }, adapters),
    ).toEqual({ ok: true });
    const insert = keyWrites().find((each) => each.verb === "insert");
    expect(insert!.body).toMatchObject({
      provider: "wallbit",
      key_hint: "0001",
    });
  });

  it("asks a provider at most five times a minute for a user", async () => {
    const results = [];
    for (let i = 0; i < 6; i += 1) {
      results.push(await connectApiKey(INPUT, adapters));
    }
    expect(checkReadOnly.mock.calls.length).toBeLessThanOrEqual(5);
    expect(results.at(-1)).toEqual({ ok: false, code: "limited" });
    expect(lines.at(-1)).toMatchObject({ "plant.outcome": "limited" });
  });

  it("limits each user on their own, so other users using theirs up locks out nobody", async () => {
    for (let user = 1; user <= 20; user += 1) {
      mockSessionUser.id = `user-${user}`;
      for (let i = 0; i < 5; i += 1) await connectApiKey(INPUT, adapters);
    }
    checkReadOnly.mockClear();
    mockSessionUser.id = "user-21";
    expect(await connectApiKey(INPUT, adapters)).toEqual({ ok: true });
    expect(checkReadOnly).toHaveBeenCalledTimes(1);
  });

  it("answers not found when the database refuses the account", async () => {
    answers.account_api_keys!.mockImplementation((verb) =>
      verb === "update"
        ? { status: 200, data: [], error: null }
        : { status: 403, error: { code: "42501" } },
    );
    expect(await connectApiKey(INPUT, adapters)).toEqual({
      ok: false,
      code: "not_found",
    });
  });
});

describe("readApiKey", () => {
  const client = (imports: unknown[]) =>
    ({
      from: (table: string) => {
        const data =
          table === "account_api_keys"
            ? [
                {
                  provider: "iol",
                  key_hint: "lcom",
                  created_at: "2026-10-14T15:10:00Z",
                },
              ]
            : imports;
        const builder = {
          select: () => builder,
          eq: () => builder,
          or: () => builder,
          order: () => builder,
          limit: () => builder,
          then: (resolve: (value: unknown) => unknown) =>
            resolve({ status: 200, data, error: null }),
        };
        return builder;
      },
    }) as unknown as Parameters<typeof readApiKey>[0];

  it("adds the latest sync, at its Buenos Aires day and time", async () => {
    const view = await readApiKey(
      client([
        {
          id: "import-1",
          status: "failed",
          failure: "connection_rejected",
          updated_at: "2026-10-14T15:31:58Z",
        },
      ]),
      ACCOUNT,
    );
    expect(view).toEqual({
      provider: "iol",
      keyHint: "lcom",
      connectedOn: "2026-10-14",
      lastSync: {
        importId: "import-1",
        status: "failed",
        failure: "connection_rejected",
        on: "2026-10-14",
        at: "12:31",
      },
    });
  });

  it("has no latest sync before the first", async () => {
    expect((await readApiKey(client([]), ACCOUNT))?.lastSync).toBeNull();
  });
});

const HOLDINGS_SYNC = {
  sync_draft: "holdings",
  sync_from: null,
  sync_to: null,
};

describe("syncAccount", () => {
  it("starts an import of the account's holdings and its job", async () => {
    expect(await syncAccount(ACCOUNT)).toEqual({ ok: true, importId: "i1" });
    expect(writes).toContainEqual(
      expect.objectContaining({
        table: "imports",
        verb: "insert",
        body: {
          source_connection_id: ACCOUNT,
          provider: "binance",
          sync_draft: "holdings",
          sync_from: null,
          sync_to: null,
        },
      }),
    );
    expect(startImport).toHaveBeenCalledWith({
      importId: "i1",
      userId: USER,
      retry: undefined,
    });
  });

  it("starts a sync of operations only where the provider gives them", async () => {
    expect(await syncAccount(ACCOUNT, "operations")).toEqual({
      ok: false,
      code: "invalid",
    });
    expect(writes).toEqual([]);
    answers.account_api_keys = answer(() => ({
      status: 200,
      data: [{ provider: "wallbit" }],
      error: null,
    }));
    expect(
      await syncAccount(ACCOUNT, "operations", {
        from: "2026-01-01",
        to: null,
      }),
    ).toEqual({ ok: true, importId: "i1" });
    expect(writes).toContainEqual(
      expect.objectContaining({
        table: "imports",
        body: {
          source_connection_id: ACCOUNT,
          provider: "wallbit",
          sync_draft: "operations",
          sync_from: "2026-01-01",
          sync_to: null,
        },
      }),
    );
  });

  it.each([
    [
      "a period on a sync of holdings",
      "holdings",
      { from: "2026-01-01", to: null },
    ],
    [
      "a period that ends before it starts",
      "operations",
      { from: "2026-02-01", to: "2026-01-01" },
    ],
    ["a day that is not one", "operations", { from: "2026-02-30", to: null }],
    [
      "a period that ends before 2000",
      "operations",
      { from: null, to: "1999-12-31" },
    ],
    [
      "a period past year 9999",
      "operations",
      { from: "2026-01-01", to: "10000-01-01" },
    ],
  ])("refuses %s", async (_, draft, period) => {
    answers.account_api_keys = answer(() => ({
      status: 200,
      data: [{ provider: "wallbit" }],
      error: null,
    }));
    expect(await syncAccount(ACCOUNT, draft, period)).toEqual({
      ok: false,
      code: "invalid",
    });
    expect(writes).toEqual([]);
  });

  it.each([
    ["PT404", "not_connected"],
    ["PT409", "in_progress"],
  ] as const)("maps the database's %s", async (code, refused) => {
    answers.imports = answer((verb) =>
      verb === "insert"
        ? { status: code === "PT404" ? 404 : 409, data: null, error: { code } }
        : { status: 200, data: [], error: null },
    );
    expect(await syncAccount(ACCOUNT)).toEqual({ ok: false, code: refused });
    expect(startImport).not.toHaveBeenCalled();
  });

  it("answers ok when the job cannot be sent, leaving the sync queued", async () => {
    startImport.mockRejectedValue(new Error("inngest down"));
    expect(await syncAccount(ACCOUNT)).toEqual({ ok: true, importId: "i1" });
  });

  it("sends a queued sync's job again as a retry instead of starting another, so a lost job never locks the account", async () => {
    answers.imports = answer((verb) =>
      verb === "insert"
        ? { status: 409, data: null, error: { code: "PT409" } }
        : {
            status: 200,
            data: [{ id: "q1", status: "queued", ...HOLDINGS_SYNC }],
            error: null,
          },
    );
    expect(await syncAccount(ACCOUNT)).toEqual({ ok: true, importId: "q1" });
    expect(startImport).toHaveBeenCalledWith({
      importId: "q1",
      userId: USER,
      retry: expect.any(String),
    });
    expect(writes.filter((each) => each.table === "imports")).toEqual([]);
  });

  it.each([
    [
      "another draft",
      "holdings",
      null,
      { sync_draft: "operations" },
      { p_sync_draft: "holdings" },
    ],
    [
      "another period",
      "operations",
      { from: "2026-02-01", to: "2026-02-28" },
      {
        sync_draft: "operations",
        sync_from: "2026-01-01",
        sync_to: "2026-01-31",
      },
      {
        p_sync_draft: "operations",
        p_sync_from: "2026-02-01",
        p_sync_to: "2026-02-28",
      },
    ],
  ] as const)(
    "fails a queued sync of %s and starts the one asked for in one write, so a lost job never locks the account",
    async (_, draft, period, queued, asked) => {
      answers.account_api_keys = answer(() => ({
        status: 200,
        data: [{ provider: "wallbit" }],
        error: null,
      }));
      answers.imports = answer(() => ({
        status: 200,
        data: [{ id: "q1", status: "queued", ...HOLDINGS_SYNC, ...queued }],
        error: null,
      }));
      rpcAnswer = () => ({ status: 200, data: "i1", error: null });
      expect(await syncAccount(ACCOUNT, draft, period)).toEqual({
        ok: true,
        importId: "i1",
      });
      expect(rpcs).toEqual([
        {
          name: "supersede_queued_sync",
          args: {
            p_queued_id: "q1",
            p_source_connection_id: ACCOUNT,
            p_provider: "wallbit",
            ...asked,
          },
        },
      ]);
      expect(
        writes.filter(
          (each) => each.table === "imports" && each.verb === "insert",
        ),
      ).toEqual([]);
      expect(startImport).toHaveBeenCalledWith({
        importId: "i1",
        userId: USER,
        retry: undefined,
      });
    },
  );

  it("discards the account's syncs of the same kind still ready to review", async () => {
    expect(await syncAccount(ACCOUNT)).toEqual({ ok: true, importId: "i1" });
    expect(
      writes.filter(
        (each) => each.table === "imports" && each.verb === "update",
      ),
    ).toEqual([
      {
        table: "imports",
        verb: "update",
        body: { status: "failed" },
        filters: [
          ["source_connection_id", ACCOUNT],
          ["sync_draft", "holdings"],
          ["status", "ready"],
        ],
      },
    ]);
  });

  // A queued sync of operations, which a sync of holdings supersedes.
  const queuedOperations = () =>
    answer(() => ({
      status: 200,
      data: [
        {
          id: "q1",
          status: "queued",
          ...HOLDINGS_SYNC,
          sync_draft: "operations",
        },
      ],
      error: null,
    }));

  it("logs the queued sync it failed for the new one", async () => {
    answers.imports = queuedOperations();
    rpcAnswer = () => ({ status: 200, data: "i1", error: null });
    await syncAccount(ACCOUNT);
    expect(lines).toContainEqual(
      expect.objectContaining({
        "plant.connection.step": "sync",
        "plant.outcome": "superseded",
        "plant.import.id": "q1",
      }),
    );
  });

  it("leaves the queued sync as it was when the new one fails to start", async () => {
    answers.imports = queuedOperations();
    rpcAnswer = () => ({ status: 500, data: null, error: { code: "XX000" } });
    expect(await syncAccount(ACCOUNT)).toEqual({
      ok: false,
      code: "failed",
    });
    expect(lines).not.toContainEqual(
      expect.objectContaining({ "plant.outcome": "superseded" }),
    );
    expect(startImport).not.toHaveBeenCalled();
  });

  it("answers not connected when the key went before the new sync started", async () => {
    answers.imports = queuedOperations();
    rpcAnswer = () => ({ status: 404, data: null, error: { code: "PT404" } });
    expect(await syncAccount(ACCOUNT)).toEqual({
      ok: false,
      code: "not_connected",
    });
  });

  it("answers in progress when the queued sync it would fail starts being read", async () => {
    answers.imports = queuedOperations();
    rpcAnswer = () => ({ status: 200, data: null, error: null });
    expect(await syncAccount(ACCOUNT)).toEqual({
      ok: false,
      code: "in_progress",
    });
    expect(writes.filter((each) => each.table === "imports")).toEqual([]);
    expect(startImport).not.toHaveBeenCalled();
  });

  it("reads a queued sync with no draft, from before syncs of operations, as one of holdings", async () => {
    answers.imports = answer(() => ({
      status: 200,
      data: [
        { id: "q1", status: "queued", ...HOLDINGS_SYNC, sync_draft: null },
      ],
      error: null,
    }));
    expect(await syncAccount(ACCOUNT)).toEqual({ ok: true, importId: "q1" });
    expect(startImport).toHaveBeenCalledWith({
      importId: "q1",
      userId: USER,
      retry: expect.any(String),
    });
    expect(writes.filter((each) => each.table === "imports")).toEqual([]);
  });

  it("starts at most ten syncs a minute for a user", async () => {
    for (let each = 0; each < 10; each += 1) {
      expect(await syncAccount(ACCOUNT)).toEqual({ ok: true, importId: "i1" });
    }
    writes.length = 0;
    expect(await syncAccount(ACCOUNT)).toEqual({
      ok: false,
      code: "limited",
    });
    expect(writes).toEqual([]);
    clock += 60_000;
    (Date.now as jest.Mock).mockReturnValue(clock);
    expect(await syncAccount(ACCOUNT)).toEqual({ ok: true, importId: "i1" });
  });

  it("logs the import a sync started", async () => {
    await syncAccount(ACCOUNT);
    expect(lines).toContainEqual(
      expect.objectContaining({
        "plant.connection.step": "sync",
        "plant.outcome": "ok",
        "plant.import.id": "i1",
      }),
    );
  });

  it("logs the import whose job could not be sent", async () => {
    startImport.mockRejectedValue(new Error("inngest down"));
    await syncAccount(ACCOUNT);
    expect(lines).toContainEqual(
      expect.objectContaining({
        "plant.connection.step": "job",
        "plant.import.id": "i1",
      }),
    );
  });

  it("leaves a sync being read alone", async () => {
    answers.imports = answer(() => ({
      status: 200,
      data: [{ id: "r1", status: "reading" }],
      error: null,
    }));
    expect(await syncAccount(ACCOUNT)).toEqual({
      ok: false,
      code: "in_progress",
    });
    expect(startImport).not.toHaveBeenCalled();
  });

  it("sends the job of the sync that won a race to start", async () => {
    let reads = 0;
    answers.imports = answer((verb) =>
      verb === "insert"
        ? { status: 409, data: null, error: { code: "PT409" } }
        : {
            status: 200,
            data:
              (reads += 1) === 1
                ? []
                : [{ id: "q2", status: "queued", ...HOLDINGS_SYNC }],
            error: null,
          },
    );
    expect(await syncAccount(ACCOUNT)).toEqual({ ok: true, importId: "q2" });
    expect(startImport).toHaveBeenCalledWith({
      importId: "q2",
      userId: USER,
      retry: expect.any(String),
    });
  });

  it("waits for the terms in force before asking the provider for anything", async () => {
    answers.consents = answer(() => ({ status: 200, data: [], error: null }));
    expect(await syncAccount(ACCOUNT)).toEqual({ ok: false, code: "terms" });
    expect(writes).toEqual([]);
    expect(startImport).not.toHaveBeenCalled();
    expect(lines.at(-1)).toMatchObject({ "plant.outcome": "terms" });
  });

  it("does not start on an account with no key", async () => {
    answers.account_api_keys = answer(() => ({
      status: 200,
      data: [],
      error: null,
    }));
    expect(await syncAccount(ACCOUNT)).toEqual({
      ok: false,
      code: "not_connected",
    });
    expect(writes).toEqual([]);
  });
});

it("disconnects only the user's key on that account", async () => {
  expect(await disconnectApiKey(ACCOUNT)).toEqual({ ok: true });
  expect(writes).toEqual([
    expect.objectContaining({
      table: "account_api_keys",
      verb: "delete",
      filters: [
        ["user_id", USER],
        ["source_connection_id", ACCOUNT],
      ],
    }),
  ]);
});
