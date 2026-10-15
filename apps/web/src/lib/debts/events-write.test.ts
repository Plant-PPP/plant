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
    rpc: async (name: string, args: unknown) => {
      calls.push([name, args]);
      return response();
    },
  }),
}));

import { captureServerLog } from "@/lib/log/capture-server-log";

import { writeLiabilityEvent } from "./events-write";

const DEBT = "d1000000-0000-4000-8000-0000000000d1";
const EVENT_ID = "e1000000-0000-4000-8000-0000000000e1";
const HOLDING = "a7000000-0000-4000-8000-0000000000a7";
const PAYMENT = {
  kind: "payment",
  date: "2026-02-01",
  amount: "1500.5",
  settles: false,
};

let lines: Record<string, unknown>[];
beforeEach(() => {
  lines = captureServerLog();
  calls.length = 0;
  revalidatePath.mockClear();
  response.mockReset();
});

it("records a payment taken from a cash holding through its RPC", async () => {
  response.mockReturnValue({ data: EVENT_ID, error: null, status: 200 });
  const cash = { holding_id: HOLDING, take: true, expected: "2000" };
  expect(
    await writeLiabilityEvent({
      action: "record_liability_event",
      debtId: DEBT,
      event: PAYMENT,
      cash,
    }),
  ).toEqual({ ok: true, id: EVENT_ID, cashRestored: true });
  expect(calls).toEqual([
    [
      "record_liability_event",
      { p_liability_id: DEBT, p_event: PAYMENT, p_cash: cash },
    ],
  ]);
  expect(revalidatePath).toHaveBeenCalledWith("/debts", "layout");
  expect(revalidatePath).toHaveBeenCalledWith("/");
  expect(revalidatePath).toHaveBeenCalledWith("/assets", "layout");
  expect(lines.at(-1)).toMatchObject({
    event: "liabilities.write",
    "plant.liability.action": "record_liability_event",
    "plant.liability.event_kind": "payment",
    "plant.liability.cash_link": true,
    "plant.liability.cash_taken": true,
    "plant.outcome": "ok",
  });
  expect(lines.at(-1)!["plant.liability.cash_restored"]).toBeUndefined();
  // Never an amount, and the flags are not masked.
  expect(JSON.stringify(lines)).not.toContain("1500");
  expect(JSON.stringify(lines)).not.toContain("2000");
});

it("leaves Activos alone when a payment takes no cash", async () => {
  response.mockReturnValue({ data: EVENT_ID, error: null, status: 200 });
  await writeLiabilityEvent({
    action: "record_liability_event",
    debtId: DEBT,
    event: PAYMENT,
    cash: { holding_id: HOLDING, take: false, expected: null },
  });
  expect(revalidatePath).not.toHaveBeenCalledWith("/assets", "layout");
});

it("says when a deleted payment's cash could not go back", async () => {
  response.mockReturnValue({ data: false, error: null, status: 200 });
  expect(
    await writeLiabilityEvent({
      action: "delete_liability_event",
      eventId: EVENT_ID,
    }),
  ).toEqual({ ok: true, id: EVENT_ID, cashRestored: false });
  expect(lines.at(-1)).toMatchObject({
    "plant.liability.cash_restored": false,
  });
});

it.each([
  ["PT409", "stale", "stale"],
  ["PT409", "settled", "settled"],
  ["PT409", "source_connection_archived", "source_connection_archived"],
  ["PT409", "anything else", "failed"],
  ["PT404", "not_found", "not_found"],
  ["40P01", null, "retry"],
  ["22023", null, "invalid"],
])("maps %s %s to %s", async (code, hint, expected) => {
  response.mockReturnValue({
    data: null,
    error: { code, message: "x", hint },
    status: 409,
  });
  expect(
    await writeLiabilityEvent({
      action: "update_liability_event",
      eventId: EVENT_ID,
      event: PAYMENT,
      cash: null,
    }),
  ).toEqual({ ok: false, code: expected });
  expect(lines.at(-1)).toMatchObject({
    level: expected === "failed" ? "error" : "warn",
  });
});

it("refuses an event that is not one a user fills, without calling", async () => {
  expect(
    await writeLiabilityEvent({
      action: "record_liability_event",
      debtId: DEBT,
      event: { ...PAYMENT, cash_holding_id: HOLDING },
      cash: null,
    }),
  ).toEqual({ ok: false, code: "invalid" });
  expect(calls).toEqual([]);
  expect(revalidatePath).not.toHaveBeenCalled();
});
