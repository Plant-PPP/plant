import { createClient, type SupabaseClient } from "@supabase/supabase-js";

jest.mock("server-only", () => ({}), { virtual: true });
jest.mock("@/lib/auth/session-claims", () => ({
  getSessionClaims: async () => ({ sub: mockSessionUser.id }),
}));
jest.mock("@/lib/request-id-server", () => ({
  currentRequestId: async () => undefined,
}));
const mockVerify = jest.fn();
jest.mock("./catalog-search", () => ({
  catalogSearch: () => ({ verify: mockVerify }),
}));
let mockClient: SupabaseClient | null = null;
jest.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => mockClient,
}));

const mockSessionUser = { id: "user-1" };

import { captureServerLog } from "@/lib/log/capture-server-log";

import { addListedInstrument } from "./instrument-catalog-sink";

const GGAL = {
  symbol: "GGAL",
  name: "Grupo Financiero Galicia",
  type: "stock",
  currency: "ARS",
  market: "byma",
};

let fetch: jest.Mock;

beforeEach(() => {
  captureServerLog();
  mockVerify.mockReset().mockResolvedValue(GGAL);
  fetch = jest.fn(async () => new Response(null, { status: 201 }));
  mockClient = createClient("http://127.0.0.1:54321", "test-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch },
  });
});

it("adds what the provider lists, never what the browser says", async () => {
  mockSessionUser.id = "user-add";
  expect(await addListedInstrument("GGAL", "byma")).toEqual({
    ok: true,
    symbol: "GGAL",
  });
  expect(mockVerify).toHaveBeenCalledWith("GGAL", "byma");
  const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
  expect(url).toMatch(/\/rest\/v1\/instruments\?on_conflict=symbol$/);
  expect(JSON.parse(String(init.body))).toEqual({
    symbol: "GGAL",
    name: "Grupo Financiero Galicia",
    type: "stock",
    currency: "ARS",
  });
  expect(new Headers(init.headers).get("prefer")).toContain(
    "resolution=ignore-duplicates",
  );
});

it("adds nothing the provider does not list", async () => {
  mockSessionUser.id = "user-unlisted";
  mockVerify.mockResolvedValue(null);
  expect(await addListedInstrument("NOPE", "byma")).toEqual({
    ok: false,
    code: "not_listed",
  });
  expect(fetch).not.toHaveBeenCalled();
});

it.each([
  ["a lowercase symbol", "ggal", "byma"],
  ["an unknown market", "GGAL", "nasdaq"],
  ["no symbol", undefined, "byma"],
])("refuses %s without asking the provider", async (_label, symbol, market) => {
  mockSessionUser.id = "user-invalid";
  expect(await addListedInstrument(symbol, market)).toEqual({
    ok: false,
    code: "invalid",
  });
  expect(mockVerify).not.toHaveBeenCalled();
});

it("answers unavailable when the provider does not answer", async () => {
  mockSessionUser.id = "user-down";
  mockVerify.mockRejectedValue(new Error("down"));
  expect(await addListedInstrument("GGAL", "byma")).toEqual({
    ok: false,
    code: "unavailable",
  });
});

it("refuses a user's eleventh add in a minute", async () => {
  mockSessionUser.id = "user-limit";
  for (let i = 0; i < 10; i += 1) await addListedInstrument("GGAL", "byma");
  expect(await addListedInstrument("GGAL", "byma")).toEqual({
    ok: false,
    code: "limited",
  });
});

it("fails when the insert is refused", async () => {
  mockSessionUser.id = "user-refused";
  fetch.mockResolvedValue(
    new Response(JSON.stringify({ code: "42501", message: "denied" }), {
      status: 403,
      headers: { "content-type": "application/json" },
    }),
  );
  expect(await addListedInstrument("GGAL", "byma")).toEqual({
    ok: false,
    code: "failed",
  });
});
