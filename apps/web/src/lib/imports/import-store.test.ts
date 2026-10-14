import { createClient } from "@supabase/supabase-js";

jest.mock("server-only", () => ({}), { virtual: true });

import { createImportStore, ImportStoreError } from "./import-store";

type Call = { method: string; url: URL; body: unknown };

// A service-role client whose requests are recorded and answered by `answer`.
function storeWith(answer: (call: Call) => { status: number; body?: unknown }) {
  const calls: Call[] = [];
  const fetch = jest.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const call = {
        method: init?.method ?? "GET",
        url: new URL(String(input)),
        body:
          typeof init?.body === "string" ? JSON.parse(init.body) : init?.body,
      };
      calls.push(call);
      const { status, body } = answer(call);
      return new Response(body === undefined ? null : JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      });
    },
  );
  const client = createClient("http://127.0.0.1:54321", "test-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch },
  });
  return { store: createImportStore(client as never), calls };
}

const IMPORT = "a1000000-0000-4000-8000-0000000000a1";
const USER = "a0000000-0000-4000-8000-00000000000a";
const ACCOUNT = "a2000000-0000-4000-8000-0000000000a2";
// Made up.
const CREDENTIALS = {
  apiKey: "MadeUpKey0000001",
  apiSecret: "MadeUpSecret0001",
};

it("loads an import with its owner, status and file", async () => {
  const { store, calls } = storeWith(() => ({
    status: 200,
    body: [
      {
        user_id: USER,
        status: "queued",
        source_connection_id: null,
        provider: null,
        document: { storage_path: "p", mime_type: "application/pdf" },
      },
    ],
  }));
  expect(await store.load(IMPORT, USER)).toEqual({
    userId: USER,
    status: "queued",
    origin: "file",
    path: "p",
    mimeType: "application/pdf",
  });
  expect(calls[0]!.url.searchParams.get("id")).toBe(`eq.${IMPORT}`);
  expect(calls[0]!.url.searchParams.get("user_id")).toBe(`eq.${USER}`);
});

it("loads a sync with its account, provider and draft", async () => {
  const { store } = storeWith(() => ({
    status: 200,
    body: [
      {
        user_id: USER,
        status: "queued",
        source_connection_id: ACCOUNT,
        provider: "wallbit",
        sync_draft: "operations",
        sync_from: "2026-01-01",
        sync_to: null,
        document: null,
      },
    ],
  }));
  expect(await store.load(IMPORT, USER)).toEqual({
    userId: USER,
    status: "queued",
    origin: "connection",
    accountId: ACCOUNT,
    provider: "wallbit",
    draft: "operations",
    period: { from: "2026-01-01", to: null },
  });
});

describe("an account's credentials", () => {
  it("are read out of Vault by the database, for that user's account and provider only", async () => {
    const { store, calls } = storeWith(() => ({
      status: 200,
      body: CREDENTIALS,
    }));
    expect(await store.credentials(USER, ACCOUNT, "binance")).toEqual(
      CREDENTIALS,
    );
    expect(calls[0]!.url.pathname).toBe("/rest/v1/rpc/account_credentials");
    expect(calls[0]!.body).toEqual({
      p_user_id: USER,
      p_source_connection_id: ACCOUNT,
      p_provider: "binance",
    });
  });

  it("are null when the account holds none", async () => {
    const { store } = storeWith(() => ({ status: 200, body: null }));
    expect(await store.credentials(USER, ACCOUNT, "binance")).toBeNull();
  });

  it("fail the step when the database does not answer, keeping no detail", async () => {
    const { store } = storeWith(() => ({
      status: 500,
      body: { code: "XX000", message: "boom", details: CREDENTIALS.apiSecret },
    }));
    const error = await store
      .credentials(USER, ACCOUNT, "binance")
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ step: "credentials", code: "XX000" });
    expect(String(error)).not.toContain(CREDENTIALS.apiSecret);
  });
});

it("loads nothing for an import that does not exist", async () => {
  const { store } = storeWith(() => ({ status: 200, body: [] }));
  expect(await store.load(IMPORT, USER)).toBeNull();
});

it("reads the institution of the import's account, as that import's user", async () => {
  const { store, calls } = storeWith(() => ({
    status: 200,
    body: [{ document: { account: { institution: "IOL" } } }],
  }));
  expect(await store.institution(IMPORT, USER)).toBe("IOL");
  expect(calls[0]!.url.searchParams.get("id")).toBe(`eq.${IMPORT}`);
  expect(calls[0]!.url.searchParams.get("user_id")).toBe(`eq.${USER}`);
});

it("refuses an import with no account to read the institution of", async () => {
  const { store } = storeWith(() => ({
    status: 200,
    body: [{ document: null }],
  }));
  const error = await store.institution(IMPORT, USER).catch((e: unknown) => e);
  expect(error).toMatchObject({ step: "institution", code: "no_data" });
});

it("reads no institution for an import deleted meanwhile", async () => {
  const { store } = storeWith(() => ({ status: 200, body: [] }));
  expect(await store.institution(IMPORT, USER)).toBeNull();
});

it("downloads no file where none is any more", async () => {
  const { store } = storeWith(() => ({
    status: 400,
    body: {
      statusCode: "404",
      error: "not_found",
      message: "Object not found",
    },
  }));
  expect(await store.download("p")).toBeNull();
});

it("throws a store error when a download fails otherwise", async () => {
  const { store } = storeWith(() => ({
    status: 500,
    body: { statusCode: "500", error: "internal", message: "boom" },
  }));
  const error = await store.download("p").catch((e: unknown) => e);
  expect(error).toMatchObject({ step: "download" });
});

const DRAFT = {
  documentDate: "2026-09-30",
  rows: [
    {
      symbol: "AAPL",
      quantity: "5",
      price: null,
      value: "90000",
      currency: "ARS" as const,
      confidence: "low" as const,
      page: 2,
    },
    {
      symbol: "USD",
      quantity: "812.4",
      price: null,
      value: null,
      assetClass: "cash" as const,
      currency: "USD" as const,
      confidence: "high" as const,
      page: null,
    },
  ],
  totals: [{ currency: "USD" as const, amount: "120.5" }],
};

// PostgREST's answers to a draft's writes, the import still being read
// unless `beingRead` says otherwise.
const draftAnswers =
  ({ beingRead = true, marked = true } = {}) =>
  ({ method }: Call) => {
    if (method === "GET")
      return { status: 200, body: beingRead ? [{ id: IMPORT }] : [] };
    if (method === "POST") return { status: 201 };
    if (method === "PATCH")
      return { status: 200, body: marked ? [{ id: IMPORT }] : [] };
    return { status: 204 };
  };

it("replaces the draft, then marks the import ready at the document's date", async () => {
  const { store, calls } = storeWith(draftAnswers());
  expect(await store.saveDraft(IMPORT, USER, DRAFT, 2)).toBe(true);
  expect(calls.map(({ method, url }) => `${method} ${url.pathname}`)).toEqual([
    "GET /rest/v1/imports",
    "DELETE /rest/v1/import_items",
    "DELETE /rest/v1/import_operations",
    "DELETE /rest/v1/import_debts",
    "POST /rest/v1/import_items",
    "PATCH /rest/v1/imports",
  ]);
  for (const call of [calls[0]!, calls[5]!]) {
    expect(call.url.searchParams.get("id")).toBe(`eq.${IMPORT}`);
    expect(call.url.searchParams.get("user_id")).toBe(`eq.${USER}`);
    expect(call.url.searchParams.get("status")).toBe("in.(queued,reading)");
  }
  for (const call of [calls[1]!, calls[2]!, calls[3]!]) {
    expect(call.url.searchParams.get("import_id")).toBe(`eq.${IMPORT}`);
    expect(call.url.searchParams.get("user_id")).toBe(`eq.${USER}`);
  }
  expect(calls[4]!.body).toEqual([
    {
      user_id: USER,
      import_id: IMPORT,
      position: 0,
      symbol: "AAPL",
      quantity: "5",
      price: null,
      value: "90000",
      cost: null,
      account: null,
      asset_class: "instrument",
      currency: "ARS",
      confidence: "low",
      source_page: 2,
    },
    {
      user_id: USER,
      import_id: IMPORT,
      position: 1,
      symbol: "USD",
      quantity: "812.4",
      price: null,
      value: null,
      cost: null,
      account: null,
      asset_class: "cash",
      currency: "USD",
      confidence: "high",
      source_page: null,
    },
  ]);
  expect(calls[5]!.body).toEqual({
    status: "ready",
    document_date: "2026-09-30",
    printed_total_ars: null,
    printed_total_usd: "120.5",
    skipped_rows: 2,
  });
});

it("replaces any draft with the operations, then marks the import ready", async () => {
  const { store, calls } = storeWith(draftAnswers());
  await store.saveOperations(
    IMPORT,
    USER,
    [
      {
        date: "2026-09-01",
        kind: "purchase",
        symbol: null,
        quantity: "100",
        price: "5000",
        amount: null,
        charges: "25.5",
        reference: "123",
        currency: "ARS",
        confidence: "low",
        page: 1,
      },
    ],
    3,
  );
  expect(calls.map(({ method, url }) => `${method} ${url.pathname}`)).toEqual([
    "GET /rest/v1/imports",
    "DELETE /rest/v1/import_items",
    "DELETE /rest/v1/import_operations",
    "DELETE /rest/v1/import_debts",
    "POST /rest/v1/import_operations",
    "PATCH /rest/v1/imports",
  ]);
  expect(calls[4]!.body).toEqual([
    {
      user_id: USER,
      import_id: IMPORT,
      position: 0,
      date: "2026-09-01",
      kind: "purchase",
      symbol: null,
      quantity: "100",
      price: "5000",
      amount: null,
      charges: "25.5",
      reference: "123",
      currency: "ARS",
      confidence: "low",
      source_page: 1,
    },
  ]);
  expect(calls[5]!.body).toEqual({
    status: "ready",
    document_date: null,
    printed_total_ars: null,
    printed_total_usd: null,
    skipped_rows: 3,
  });
});

it("writes no draft for an import no longer being read", async () => {
  const { store, calls } = storeWith(draftAnswers({ beingRead: false }));
  expect(await store.saveDraft(IMPORT, USER, DRAFT, 0)).toBe(false);
  expect(await store.saveOperations(IMPORT, USER, [], 0)).toBe(false);
  expect(await store.saveDebts(IMPORT, USER, [], 0)).toBe(false);
  expect(calls.map(({ method }) => method)).toEqual(["GET", "GET", "GET"]);
});

it("throws when the import stopped being read before it was marked ready", async () => {
  const { store } = storeWith(draftAnswers({ marked: false }));
  const error = await store
    .saveDraft(IMPORT, USER, DRAFT, 0)
    .catch((e: unknown) => e);
  expect(error).toMatchObject({ step: "draft", code: "not_being_read" });
});

it("marks an import reading only from queued or reading", async () => {
  const { store, calls } = storeWith(() => ({ status: 204 }));
  await store.reading(IMPORT, USER);
  expect(calls[0]!.url.searchParams.get("user_id")).toBe(`eq.${USER}`);
  expect(calls[0]!.url.searchParams.get("status")).toBe("in.(queued,reading)");
  expect(calls[0]!.body).toEqual({ status: "reading" });
});

it("marks an import failed with its reason, only while it is being read", async () => {
  const { store, calls } = storeWith(() => ({ status: 204 }));
  await store.failed(IMPORT, USER, "nothing_found");
  expect(calls[0]!.url.searchParams.get("user_id")).toBe(`eq.${USER}`);
  expect(calls[0]!.url.searchParams.get("status")).toBe("in.(queued,reading)");
  expect(calls[0]!.body).toEqual({
    status: "failed",
    failure: "nothing_found",
  });
});

it("throws a store error with only the step and code", async () => {
  const { store } = storeWith(() => ({
    status: 500,
    body: { code: "XX000", message: "row details" },
  }));
  const error = await store.reading(IMPORT, USER).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(ImportStoreError);
  expect(error).toMatchObject({ step: "reading", code: "XX000" });
  expect(String(error)).not.toContain("row details");
});

it("replaces any draft with a card statement's debts, then marks the import ready", async () => {
  const { store, calls } = storeWith(draftAnswers());
  await store.saveDebts(
    IMPORT,
    USER,
    [
      {
        label: "Visa",
        lender: null,
        currency: "ARS",
        balance: "250000.5",
        minimumPayment: null,
        dueDate: "2026-10-20",
        confidence: "high",
        page: 1,
      },
    ],
    2,
  );
  expect(calls.map(({ method, url }) => `${method} ${url.pathname}`)).toEqual([
    "GET /rest/v1/imports",
    "DELETE /rest/v1/import_items",
    "DELETE /rest/v1/import_operations",
    "DELETE /rest/v1/import_debts",
    "POST /rest/v1/import_debts",
    "PATCH /rest/v1/imports",
  ]);
  expect(calls[4]!.body).toEqual([
    {
      user_id: USER,
      import_id: IMPORT,
      position: 0,
      label: "Visa",
      lender: null,
      currency: "ARS",
      balance: "250000.5",
      minimum_payment: null,
      due_date: "2026-10-20",
      confidence: "high",
      source_page: 1,
    },
  ]);
  expect(calls[5]!.body).toMatchObject({ skipped_rows: 2 });
});
