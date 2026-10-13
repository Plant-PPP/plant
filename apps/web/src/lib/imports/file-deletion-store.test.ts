import { createClient } from "@supabase/supabase-js";

jest.mock("server-only", () => ({}), { virtual: true });

import {
  createFileDeletionStore,
  FileDeletionStoreError,
} from "./file-deletion-store";

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
  return { store: createFileDeletionStore(client as never), calls };
}

const NOW = new Date("2026-10-13T06:20:00.000Z");

it("reads only files past their date that are still there, oldest first", async () => {
  const { store, calls } = storeWith(() => ({
    status: 200,
    body: [{ id: "d1", storage_path: "u/imports/x/y" }],
  }));
  expect(await store.due(NOW, 100)).toEqual([
    { id: "d1", path: "u/imports/x/y" },
  ]);
  const params = calls[0]!.url.searchParams;
  expect(params.get("file_deleted_at")).toBe("is.null");
  expect(params.get("delete_after")).toBe(`lt.${NOW.toISOString()}`);
  expect(params.get("order")).toBe("delete_after.asc");
  expect(params.get("limit")).toBe("100");
});

it("fails the read with the code only", async () => {
  const { store } = storeWith(() => ({
    status: 500,
    body: { code: "XX000", message: "boom", details: "u/imports/x/y" },
  }));
  const error = await store.due(NOW, 1).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(FileDeletionStoreError);
  expect(String((error as Error).message)).not.toContain("u/imports");
});

it("removes the files from the uploads bucket", async () => {
  const { store, calls } = storeWith(() => ({ status: 200, body: [] }));
  await store.remove(["u/imports/x/y"]);
  expect(calls[0]!.method).toBe("DELETE");
  expect(calls[0]!.url.pathname).toContain("/storage/v1/object/");
  expect(calls[0]!.body).toEqual({ prefixes: ["u/imports/x/y"] });
});

it("fails a removal Storage refused", async () => {
  const { store } = storeWith(() => ({
    status: 400,
    body: { statusCode: "400", error: "Bad", message: "no" },
  }));
  await expect(store.remove(["p"])).rejects.toBeInstanceOf(
    FileDeletionStoreError,
  );
});

it("marks only rows not marked before", async () => {
  const { store, calls } = storeWith(() => ({ status: 204 }));
  await store.markDeleted(["d1", "d2"], NOW);
  expect(calls[0]!.method).toBe("PATCH");
  expect(calls[0]!.body).toEqual({ file_deleted_at: NOW.toISOString() });
  expect(calls[0]!.url.searchParams.get("id")).toBe("in.(d1,d2)");
  expect(calls[0]!.url.searchParams.get("file_deleted_at")).toBe("is.null");
});

it("calls nothing for an empty batch", async () => {
  const { store, calls } = storeWith(() => ({ status: 204 }));
  await store.remove([]);
  await store.markDeleted([], NOW);
  expect(calls).toHaveLength(0);
});
