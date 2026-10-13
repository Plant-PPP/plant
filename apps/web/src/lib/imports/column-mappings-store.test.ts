import { createClient } from "@supabase/supabase-js";

jest.mock("server-only", () => ({}), { virtual: true });

import {
  ColumnMappingsError,
  createColumnMappingsStore,
  headerSignature,
} from "./column-mappings-store";

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
  return { store: createColumnMappingsStore(client as never), calls };
}

const HEADERS = ["Especie", " Cantidad "];

it("signs a set of headers exactly as written", () => {
  expect(headerSignature(HEADERS)).toBe(headerSignature([...HEADERS]));
  expect(headerSignature(HEADERS)).toMatch(/^[0-9a-f]{64}$/);
  // Another case is another format, mapped and kept on its own.
  expect(headerSignature(HEADERS)).not.toBe(
    headerSignature(["especie", " Cantidad "]),
  );
  expect(headerSignature(HEADERS)).not.toBe(
    headerSignature([" Cantidad ", "Especie"]),
  );
});

it("reads a mapping by user, institution and headers", async () => {
  const { store, calls } = storeWith(() => ({
    status: 200,
    body: [{ mapping: { symbol: "Especie" } }],
  }));
  expect(await store.get("u1", "IOL", HEADERS)).toEqual({ symbol: "Especie" });
  const params = calls[0]!.url.searchParams;
  expect(params.get("user_id")).toBe("eq.u1");
  expect(params.get("institution")).toBe("eq.IOL");
  expect(params.get("header_signature")).toBe(`eq.${headerSignature(HEADERS)}`);
});

it("reads nothing when the format has no mapping", async () => {
  const { store } = storeWith(() => ({ status: 200, body: [] }));
  expect(await store.get("u1", "IOL", HEADERS)).toBeNull();
});

it("adds a mapping under its user, keeping one already there", async () => {
  const { store, calls } = storeWith(() => ({ status: 201 }));
  await store.save("u1", "IOL", HEADERS, { symbol: "Especie" });
  expect(calls[0]!.method).toBe("POST");
  expect(calls[0]!.body).toEqual({
    user_id: "u1",
    institution: "IOL",
    header_signature: headerSignature(HEADERS),
    mapping: { symbol: "Especie" },
  });
});

it("throws a store error with only the step and code", async () => {
  const { store } = storeWith(() => ({
    status: 500,
    body: { code: "XX000", message: "Especie" },
  }));
  const error = await store.get("u1", "IOL", HEADERS).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(ColumnMappingsError);
  expect(error).toMatchObject({ step: "get", code: "XX000" });
  expect(String(error)).not.toContain("Especie");
});
