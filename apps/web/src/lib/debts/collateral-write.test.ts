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

const calls: string[] = [];
let held: string[] = [];
let insertError: { code: string } | null = null;
jest.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => {
      const query = {
        select: () => {
          calls.push("select");
          return Object.assign(
            Promise.resolve({
              data: held.map((holding_id) => ({ holding_id })),
              error: null,
              status: 200,
            }),
            query,
          );
        },
        delete: () => {
          calls.push("delete");
          return query;
        },
        eq: () =>
          Object.assign(
            Promise.resolve({
              data: null,
              error: null,
              status: calls.at(-1) === "select" ? 200 : 204,
            }),
            query,
          ),
        not: (_column: string, _op: string, list: string) => {
          calls.push(`keep ${list}`);
          return Promise.resolve({ data: null, error: null, status: 204 });
        },
        insert: async (rows: { holding_id: string }[]) => {
          calls.push(`insert ${rows.map((row) => row.holding_id).join(",")}`);
          return insertError
            ? { data: null, error: insertError, status: 409 }
            : { data: null, error: null, status: 201 };
        },
      };
      return query;
    },
  }),
}));

import { captureServerLog } from "@/lib/log/capture-server-log";

import { writeCollateral } from "./collateral-write";

const DEBT = "d1000000-0000-4000-8000-0000000000d1";
const A = "a1000000-0000-4000-8000-0000000000a1";
const B = "b1000000-0000-4000-8000-0000000000b1";

beforeEach(() => {
  calls.length = 0;
  held = [];
  insertError = null;
  revalidatePath.mockClear();
});

it("removes what is no longer pledged and adds what is new", async () => {
  const lines = captureServerLog();
  held = [A];
  expect(await writeCollateral(DEBT, [B])).toEqual({ ok: true, id: DEBT });
  expect(calls).toEqual(["select", "delete", `keep (${B})`, `insert ${B}`]);
  expect(revalidatePath).toHaveBeenCalledWith("/debts", "layout");
  expect(lines.at(-1)).toMatchObject({
    event: "liabilities.write",
    "plant.liability.action": "set_collateral",
    "plant.liability.collateral_count": 1,
    "plant.outcome": "ok",
  });
});

it("refuses another user's holding as not found", async () => {
  insertError = { code: "23503" };
  expect(await writeCollateral(DEBT, [A])).toEqual({
    ok: false,
    code: "not_found",
  });
});

it("refuses ids it cannot read", async () => {
  expect(await writeCollateral("nope", [A])).toEqual({
    ok: false,
    code: "invalid",
  });
  expect(await writeCollateral(DEBT, ["nope"])).toEqual({
    ok: false,
    code: "invalid",
  });
  expect(calls).toEqual([]);
});
