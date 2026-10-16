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
let debtExists = true;
let insertError: { code: string } | null = null;
const answer = (data: unknown, status: number) =>
  Promise.resolve({ data, error: null, status });
jest.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => {
          calls.push(`select ${table}`);
          return table === "liabilities"
            ? answer(debtExists ? [{ id: "d" }] : [], 200)
            : answer(
                held.map((holding_id) => ({ holding_id })),
                200,
              );
        },
      }),
      delete: () => {
        calls.push("delete");
        const filtered = {
          not: (_column: string, _op: string, list: string) => {
            calls.push(`keep ${list}`);
            return answer(null, 204);
          },
          then: (resolve: (value: unknown) => void) =>
            resolve({ data: null, error: null, status: 204 }),
        };
        return { eq: () => filtered };
      },
      upsert: async (
        rows: { holding_id: string }[],
        options: { ignoreDuplicates: boolean },
      ) => {
        calls.push(
          `upsert ${rows.map((row) => row.holding_id).join(",")} ${options.ignoreDuplicates}`,
        );
        return insertError
          ? { data: null, error: insertError, status: 409 }
          : { data: null, error: null, status: 201 };
      },
    }),
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
  debtExists = true;
  insertError = null;
  revalidatePath.mockClear();
});

it("removes what is no longer pledged and adds what is new", async () => {
  const lines = captureServerLog();
  held = [A];
  expect(await writeCollateral(DEBT, [B])).toEqual({ ok: true, id: DEBT });
  expect(calls).toEqual([
    "select liabilities",
    "select liability_collateral",
    "delete",
    `keep (${B})`,
    `upsert ${B} true`,
  ]);
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

it("answers not found for a debt that is not the user's", async () => {
  debtExists = false;
  expect(await writeCollateral(DEBT, [])).toEqual({
    ok: false,
    code: "not_found",
  });
  expect(calls).not.toContain("delete");
});

it("removes every pledge when none is wanted", async () => {
  held = [A];
  expect(await writeCollateral(DEBT, [])).toEqual({ ok: true, id: DEBT });
  expect(calls).toContain("delete");
  expect(calls.some((call) => call.startsWith("keep"))).toBe(false);
});

it("pledges a holding named twice once, and logs the debt", async () => {
  const lines = captureServerLog();
  expect(await writeCollateral(DEBT, [B, B])).toEqual({ ok: true, id: DEBT });
  expect(calls).toContain(`upsert ${B} true`);
  expect(lines.at(-1)).toMatchObject({
    "plant.liability.id": DEBT,
    "plant.liability.collateral_count": 1,
  });
});
