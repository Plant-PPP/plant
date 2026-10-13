jest.mock("server-only", () => ({}), { virtual: true });
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/lib/auth/session-claims", () => ({
  getSessionClaims: async () => ({ sub: "u1" }),
}));
jest.mock("@/lib/request-id-server", () => ({
  currentRequestId: async () => undefined,
}));
const quoteRead = jest.fn();
jest.mock("@/lib/quotes/quote-reader", () => ({
  createQuoteReader: () => ({ read: quoteRead }),
}));
const rpc = jest.fn();
jest.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc,
    from: () => {
      const builder = {
        select: () => builder,
        single: async () => ({
          data: { reference_dollar: "mep" },
          error: null,
          status: 200,
        }),
      };
      return builder;
    },
  }),
}));
const readLedger = jest.fn();
jest.mock("./read", () => ({
  ...jest.requireActual("./read"),
  readLedger: (...args: unknown[]) => readLedger(...args),
}));

import { captureServerLog } from "@/lib/log/capture-server-log";

import { writeOperation } from "./ledger";
import {
  emptyLedger,
  PORTFOLIO,
  PURCHASE,
} from "./ledger-fixture.test-support";
import { runOperation } from "./write";

const OPERATION = "0f000000-0000-4000-8000-00000000000f";

let lines: Record<string, unknown>[];
beforeEach(() => {
  lines = captureServerLog();
  rpc.mockReset();
  quoteRead.mockReset().mockResolvedValue(emptyLedger().quotes);
  readLedger.mockReset().mockResolvedValue({
    ledger: emptyLedger(),
    truncated: false,
    symbolOf: new Map(),
  });
});

it("admits a new operation and writes its parts with the revisions read", async () => {
  rpc.mockResolvedValue({ data: OPERATION, error: null, status: 200 });
  const result = await runOperation("create_operation", null, PURCHASE);
  expect(result).toEqual({ ok: true, id: OPERATION });
  // The rates of the operation's date, carried over a week.
  expect(quoteRead).toHaveBeenCalledWith(
    expect.objectContaining({ from: "2026-09-08", to: "2026-09-15" }),
  );
  const [name, args] = rpc.mock.calls[0]!;
  expect(name).toBe("write_operation");
  expect(args.p_operation_id).toBeNull();
  expect(args.p_expected).toEqual({});
  expect(args.p_parts).toHaveLength(2);
  expect(lines.at(-1)).toMatchObject({
    "plant.ledger.action": "create_operation",
    "plant.outcome": "ok",
  });
});

it("refuses what core refuses without writing", async () => {
  const result = await runOperation("create_operation", null, {
    ...PURCHASE,
    kind: "sale",
  });
  expect(result.ok).toBe(false);
  expect(rpc).not.toHaveBeenCalled();
});

it("expects the revision of every holding of the instrument when rewriting", async () => {
  const written = writeOperation(emptyLedger(), PURCHASE, {
    operationId: OPERATION,
    newId: () => crypto.randomUUID(),
  }).state;
  const holdingIds = written.holdings.map((each) => each.holding.id);
  readLedger.mockResolvedValue({
    ledger: { ...written, revisions: new Map(holdingIds.map((id) => [id, 3])) },
    truncated: false,
    symbolOf: new Map(holdingIds.map((id) => [id, "AAPL"])),
  });
  rpc.mockResolvedValue({ data: OPERATION, error: null, status: 200 });
  const result = await runOperation("update_operation", OPERATION, {
    ...PURCHASE,
    parts: [{ portfolio_id: PORTFOLIO, quantity: "4" }],
  });
  expect(result).toEqual({ ok: true, id: OPERATION });
  const [, args] = rpc.mock.calls[0]!;
  expect(args.p_operation_id).toBe(OPERATION);
  expect(args.p_expected).toEqual(
    Object.fromEntries(holdingIds.map((id) => [id, 3])),
  );
  expect(args.p_parts).toHaveLength(1);
});

it("deletes an operation with no parts", async () => {
  const written = writeOperation(emptyLedger(), PURCHASE, {
    operationId: OPERATION,
    newId: () => crypto.randomUUID(),
  }).state;
  readLedger.mockResolvedValue({
    ledger: written,
    truncated: false,
    symbolOf: new Map(),
  });
  rpc.mockResolvedValue({ data: null, error: null, status: 200 });
  const result = await runOperation("delete_operation", OPERATION, null);
  expect(result).toEqual({ ok: true, id: OPERATION });
  expect(rpc.mock.calls[0]![1].p_parts).toEqual([]);
});

it.each([
  [{ code: "PT404", hint: "not_found" }, "not_found"],
  [{ code: "23503", hint: null }, "not_found"],
  [{ code: "PT409", hint: "portfolio_archived" }, "portfolio_archived"],
  [{ code: "PT409", hint: "stale" }, "failed"],
])("answers the database's %o as %s", async (error, code) => {
  rpc.mockResolvedValue({ data: null, error, status: 409 });
  expect(await runOperation("create_operation", null, PURCHASE)).toEqual({
    ok: false,
    code,
  });
});

it("refuses an operation id that is not one", async () => {
  expect(await runOperation("delete_operation", "x", null)).toEqual({
    ok: false,
    code: "invalid",
  });
  expect(readLedger).not.toHaveBeenCalled();
});

it("fails without writing on a ledger cut short", async () => {
  readLedger.mockResolvedValue({
    ledger: emptyLedger(),
    truncated: true,
    symbolOf: new Map(),
  });
  expect(await runOperation("create_operation", null, PURCHASE)).toEqual({
    ok: false,
    code: "failed",
  });
  expect(rpc).not.toHaveBeenCalled();
});
