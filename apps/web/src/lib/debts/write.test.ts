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
const response = jest.fn();
const calls: unknown[][] = [];
jest.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      calls.push(["from", table]);
      const builder = {
        insert: (row: unknown) => (calls.push(["insert", row]), builder),
        update: (row: unknown) => (calls.push(["update", row]), builder),
        delete: () => (calls.push(["delete"]), builder),
        eq: (...args: unknown[]) => (calls.push(["eq", ...args]), builder),
        select: () => builder,
        then: (resolve: (value: unknown) => unknown) => resolve(response()),
      };
      return builder;
    },
  }),
}));

import { captureServerLog } from "@/lib/log/capture-server-log";

import { writeLiability } from "./write";

const ID = "d1000000-0000-4000-8000-0000000000d1";
const MORTGAGE = {
  kind: "mortgage",
  label: "Hipoteca",
  lender: "Banco Nación",
  currency: "ARS",
  uva: true,
  instrument_symbol: null,
  balance: "45000.5",
  installment: "320.25",
  annual_rate: "0.035",
  installments_left: 240,
  next_due_on: "2026-11-10",
  matures_on: null,
  accrues: false,
  opened_on: null,
};

let lines: Record<string, unknown>[];
beforeEach(() => {
  lines = captureServerLog();
  calls.length = 0;
  revalidatePath.mockClear();
  response.mockReset();
});

it("creates a debt with the fields core admits", async () => {
  response.mockReturnValue({ data: [{ id: ID }], error: null, status: 201 });
  expect(await writeLiability("create_liability", null, MORTGAGE)).toEqual({
    ok: true,
    id: ID,
  });
  expect(calls).toEqual([
    ["from", "liabilities"],
    ["insert", MORTGAGE],
  ]);
  expect(revalidatePath).toHaveBeenCalledWith("/debts", "layout");
  expect(lines.at(-1)).toMatchObject({
    event: "liabilities.write",
    "plant.liability.action": "create_liability",
    "plant.outcome": "ok",
  });
  // Never an amount.
  expect(JSON.stringify(lines)).not.toContain("45000");
});

it("updates one of the user's debts by id", async () => {
  response.mockReturnValue({ data: [{ id: ID }], error: null, status: 200 });
  expect(await writeLiability("update_liability", ID, MORTGAGE)).toEqual({
    ok: true,
    id: ID,
  });
  expect(calls).toContainEqual(["eq", "id", ID]);
});

it("says a debt that is not the user's is not found", async () => {
  response.mockReturnValue({ data: [], error: null, status: 200 });
  expect(await writeLiability("delete_liability", ID, null)).toEqual({
    ok: false,
    code: "not_found",
  });
  expect(calls).toContainEqual(["delete"]);
});

it("refuses what core refuses without writing", async () => {
  expect(
    await writeLiability("create_liability", null, {
      ...MORTGAGE,
      currency: "USD",
    }),
  ).toEqual({ ok: false, code: "invalid" });
  expect(await writeLiability("delete_liability", "x", null)).toEqual({
    ok: false,
    code: "invalid",
  });
  expect(calls).toEqual([]);
  expect(revalidatePath).not.toHaveBeenCalled();
});

it("reads a CHECK or an unknown instrument as invalid input", async () => {
  response.mockReturnValue({
    data: null,
    error: { code: "23503", message: "fk" },
    status: 409,
  });
  expect(await writeLiability("create_liability", null, MORTGAGE)).toEqual({
    ok: false,
    code: "invalid",
  });
});

it("fails on anything else, and logs it", async () => {
  response.mockReturnValue({
    data: null,
    error: { code: "XX000", message: "boom" },
    status: 500,
  });
  expect(await writeLiability("update_liability", ID, MORTGAGE)).toEqual({
    ok: false,
    code: "failed",
  });
  expect(lines.at(-1)).toMatchObject({
    level: "error",
    "plant.outcome": "failed",
  });
  expect(revalidatePath).toHaveBeenCalledWith("/debts", "layout");
});

it("reads a debt guard's refusal as invalid input, warned", async () => {
  response.mockReturnValue({
    data: null,
    error: { code: "PT409", message: "x", hint: "has_history" },
    status: 409,
  });
  expect(await writeLiability("update_liability", ID, MORTGAGE)).toEqual({
    ok: false,
    code: "invalid",
  });
  expect(lines.at(-1)).toMatchObject({
    level: "warn",
    "plant.outcome": "invalid",
  });
});
