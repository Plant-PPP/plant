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

it("loads an import with its owner, status and file", async () => {
  const { store, calls } = storeWith(() => ({
    status: 200,
    body: [
      {
        user_id: USER,
        status: "queued",
        document: { storage_path: "p", mime_type: "application/pdf" },
      },
    ],
  }));
  expect(await store.load(IMPORT, USER)).toEqual({
    userId: USER,
    status: "queued",
    path: "p",
    mimeType: "application/pdf",
  });
  expect(calls[0]!.url.searchParams.get("id")).toBe(`eq.${IMPORT}`);
  expect(calls[0]!.url.searchParams.get("user_id")).toBe(`eq.${USER}`);
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
  const { store } = storeWith(() => ({ status: 200, body: [] }));
  const error = await store.institution(IMPORT, USER).catch((e: unknown) => e);
  expect(error).toMatchObject({ step: "institution", code: "no_data" });
});

it("replaces the draft, then marks the import ready at the document's date", async () => {
  const { store, calls } = storeWith(({ method }) => ({
    status: method === "POST" ? 201 : 204,
  }));
  await store.saveDraft(IMPORT, USER, {
    documentDate: "2026-09-30",
    rows: [
      {
        symbol: "AAPL",
        quantity: "5",
        price: null,
        value: "90000",
        currency: "ARS",
        confidence: "low",
        page: 2,
      },
    ],
    totals: [{ currency: "USD", amount: "120.5" }],
  });
  expect(calls.map(({ method, url }) => `${method} ${url.pathname}`)).toEqual([
    "DELETE /rest/v1/import_items",
    "POST /rest/v1/import_items",
    "PATCH /rest/v1/imports",
  ]);
  expect(calls[0]!.url.searchParams.get("import_id")).toBe(`eq.${IMPORT}`);
  expect(calls[0]!.url.searchParams.get("user_id")).toBe(`eq.${USER}`);
  expect(calls[2]!.url.searchParams.get("user_id")).toBe(`eq.${USER}`);
  expect(calls[1]!.body).toEqual([
    {
      user_id: USER,
      import_id: IMPORT,
      position: 0,
      symbol: "AAPL",
      quantity: "5",
      price: null,
      value: "90000",
      currency: "ARS",
      confidence: "low",
      source_page: 2,
    },
  ]);
  expect(calls[2]!.body).toEqual({
    status: "ready",
    document_date: "2026-09-30",
    printed_total_ars: null,
    printed_total_usd: "120.5",
  });
});

it("marks an import failed with its reason", async () => {
  const { store, calls } = storeWith(() => ({ status: 204 }));
  await store.failed(IMPORT, USER, "nothing_found");
  expect(calls[0]!.url.searchParams.get("user_id")).toBe(`eq.${USER}`);
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
