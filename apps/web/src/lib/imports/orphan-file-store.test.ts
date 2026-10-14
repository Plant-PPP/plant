import { createClient } from "@supabase/supabase-js";

jest.mock("server-only", () => ({}), { virtual: true });

import {
  createOrphanFileStore,
  OrphanFileStoreError,
} from "./orphan-file-store";

type Call = { method: string; url: URL; body: unknown };

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
  return { store: createOrphanFileStore(client as never), calls };
}

const ROW = { id: "0b000000-0000-4000-8000-000000000001", name: "u/imports/x" };

it("asks the finder for the first batch with no cursor", async () => {
  const { store, calls } = storeWith(() => ({ status: 200, body: [ROW] }));
  expect(await store.orphans(100, null)).toEqual([
    { id: ROW.id, path: "u/imports/x" },
  ]);
  expect(calls[0]!.method).toBe("POST");
  expect(calls[0]!.url.pathname).toBe("/rest/v1/rpc/orphan_import_files");
  expect(calls[0]!.body).toEqual({ p_limit: 100 });
});

it("asks for the next batch after the cursor", async () => {
  const { store, calls } = storeWith(() => ({ status: 200, body: [] }));
  expect(await store.orphans(100, ROW.id)).toEqual([]);
  expect(calls[0]!.body).toEqual({ p_limit: 100, p_after: ROW.id });
});

it("fails the finder with the code only", async () => {
  const { store } = storeWith(() => ({
    status: 500,
    body: { code: "XX000", message: "boom", details: "u/imports/x" },
  }));
  const error = await store.orphans(1, null).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(OrphanFileStoreError);
  expect(error).toMatchObject({ step: "orphans", code: "XX000" });
  expect(String((error as Error).message)).not.toContain("u/imports");
});

it("removes the files from the uploads bucket", async () => {
  const { store, calls } = storeWith(() => ({ status: 200, body: [] }));
  await store.remove(["u/imports/x"]);
  expect(calls[0]!.method).toBe("DELETE");
  expect(calls[0]!.url.pathname).toBe("/storage/v1/object/imports");
  expect(calls[0]!.body).toEqual({ prefixes: ["u/imports/x"] });
});

it("fails a removal Storage refused", async () => {
  const { store } = storeWith(() => ({
    status: 400,
    body: { statusCode: "400", error: "Bad", message: "u/imports/x" },
  }));
  const error = await store.remove(["u/imports/x"]).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(OrphanFileStoreError);
  expect(String((error as Error).message)).not.toContain("u/imports");
});

it("calls nothing for an empty batch", async () => {
  const { store, calls } = storeWith(() => ({ status: 200 }));
  await store.remove([]);
  expect(calls).toHaveLength(0);
});
