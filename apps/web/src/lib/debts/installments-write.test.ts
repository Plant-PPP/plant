jest.mock("server-only", () => ({}), { virtual: true });
const revalidatePath = jest.fn();
jest.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePath(...args),
}));
jest.mock("@/lib/auth/session-claims", () => ({
  getSessionClaims: async () => ({ sub: "u1" }),
}));
jest.mock("@/lib/request-id-server", () => ({
  currentRequestId: async () => undefined,
}));

const rpcs: { name: string; args: unknown }[] = [];
let rpcError: { code: string } | null = null;
jest.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc: async (name: string, args: unknown) => {
      rpcs.push({ name, args });
      return rpcError
        ? { data: null, error: rpcError, status: 400 }
        : { data: 2, error: null, status: 200 };
    },
  }),
}));

import { captureServerLog } from "@/lib/log/capture-server-log";

import { writeInstallments } from "./installments-write";

const DEBT = "d1000000-0000-4000-8000-0000000000d1";
const PLAN = [
  { due_on: "2026-10-31", amount: "3160" },
  { due_on: "2026-11-30", amount: "8160" },
];

beforeEach(() => {
  rpcs.length = 0;
  rpcError = null;
  revalidatePath.mockClear();
});

it("replaces the plan through its RPC and logs the count", async () => {
  const lines = captureServerLog();
  expect(await writeInstallments(DEBT, PLAN)).toEqual({ ok: true, id: DEBT });
  expect(rpcs).toEqual([
    {
      name: "replace_liability_installments",
      args: { p_liability_id: DEBT, p_installments: PLAN },
    },
  ]);
  expect(revalidatePath).toHaveBeenCalledWith("/debts", "layout");
  expect(lines.at(-1)).toMatchObject({
    "plant.liability.action": "replace_installments",
    "plant.liability.installment_count": 2,
    "plant.outcome": "ok",
  });
});

it("refuses a malformed plan without calling the database", async () => {
  expect(
    await writeInstallments(DEBT, [{ due_on: "2026-10-31", amount: "0" }]),
  ).toEqual({ ok: false, code: "invalid" });
  expect(await writeInstallments("nope", PLAN)).toEqual({
    ok: false,
    code: "invalid",
  });
  expect(rpcs).toEqual([]);
});

it("answers not found for a debt that is not the user's", async () => {
  rpcError = { code: "PT404" };
  expect(await writeInstallments(DEBT, [])).toEqual({
    ok: false,
    code: "not_found",
  });
});
