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
const manualPrices = jest.fn();
const filters: unknown[][] = [];
jest.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc,
    from: () => {
      const builder = {
        select: () => builder,
        eq: (...args: unknown[]) => (filters.push(["eq", ...args]), builder),
        gte: (...args: unknown[]) => (filters.push(["gte", ...args]), builder),
        lte: (...args: unknown[]) => (filters.push(["lte", ...args]), builder),
        single: async () => ({
          data: { reference_dollar: "mep" },
          error: null,
          status: 200,
        }),
        then: (resolve: (value: unknown) => unknown) => resolve(manualPrices()),
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

import { suggestedTransferCost, writeOperation } from "./ledger";
import {
  ACCOUNT,
  emptyLedger,
  OTHER_PORTFOLIO,
  PORTFOLIO,
  PURCHASE,
} from "./ledger-fixture.test-support";
import { quoteOnDate, runOperation, suggestTransferCost } from "./write";

const OPERATION = "0f000000-0000-4000-8000-00000000000f";

let lines: Record<string, unknown>[];
beforeEach(() => {
  lines = captureServerLog();
  rpc.mockReset();
  filters.length = 0;
  manualPrices
    .mockReset()
    .mockReturnValue({ data: [], error: null, status: 200 });
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

describe("a transfer's suggested cost", () => {
  const bought = () =>
    writeOperation(emptyLedger(), PURCHASE, {
      operationId: OPERATION,
      replacing: false,
      newId: () => crypto.randomUUID(),
    }).state;
  const TRANSFER = {
    kind: "transfer",
    source_connection_id: ACCOUNT,
    instrument_symbol: "AAPL",
    date: "2026-09-16",
    currency: "ARS",
    reference: null,
    note: null,
    parts: [
      { portfolio_id: PORTFOLIO, direction: "out", quantity: "1" },
      { portfolio_id: OTHER_PORTFOLIO, direction: "in", quantity: "1" },
    ],
  };

  it("is what the write would carry, on the ledger as read", async () => {
    const ledger = bought();
    readLedger.mockResolvedValue({
      ledger,
      truncated: false,
      symbolOf: new Map(),
    });
    const query = { input: TRANSFER, operationId: null };
    const cost = await suggestTransferCost(query);
    expect(cost).not.toBeNull();
    expect(cost).toBe(suggestedTransferCost(ledger, query));
    expect(quoteRead).toHaveBeenCalledWith(
      expect.objectContaining({ from: "2026-09-09", to: "2026-09-16" }),
    );
    expect(lines.at(-1)).toMatchObject({
      "plant.ledger.action": "suggest_transfer_cost",
      "plant.outcome": "ok",
    });
  });

  it("is none for a question that is not one, without reading", async () => {
    expect(await suggestTransferCost({ input: TRANSFER })).toBeNull();
    expect(readLedger).not.toHaveBeenCalled();
  });

  it("is none on a ledger cut short", async () => {
    readLedger.mockResolvedValue({
      ledger: bought(),
      truncated: true,
      symbolOf: new Map(),
    });
    expect(
      await suggestTransferCost({ input: TRANSFER, operationId: null }),
    ).toBeNull();
    expect(lines.at(-1)).toMatchObject({ "plant.outcome": "failed" });
  });
});

describe("a day's quote", () => {
  const QUERY = { symbol: "AAPL", currency: "ARS", date: "2026-09-15" };

  it("is the feed's latest price in the week up to the day", async () => {
    quoteRead.mockResolvedValue({
      fxRates: [],
      prices: [
        {
          symbol: "AAPL",
          price_date: "2026-09-12",
          price: "17500",
          currency: "ARS",
        },
      ],
    });
    expect(await quoteOnDate(QUERY)).toBe("17500");
    expect(quoteRead).toHaveBeenCalledWith({
      from: "2026-09-08",
      to: "2026-09-15",
      fxKinds: [],
      symbols: ["AAPL"],
    });
    expect(filters).toEqual([
      ["eq", "symbol", "AAPL"],
      ["gte", "price_date", "2026-09-08"],
      ["lte", "price_date", "2026-09-15"],
    ]);
    expect(readLedger).not.toHaveBeenCalled();
  });

  it("takes the user's manual price over the feed's", async () => {
    manualPrices.mockReturnValue({
      data: [
        {
          symbol: "AAPL",
          price_date: "2026-09-15",
          price: "18100",
          currency: "ARS",
        },
      ],
      error: null,
      status: 200,
    });
    expect(await quoteOnDate(QUERY)).toBe("18100");
  });

  it("is none in another currency", async () => {
    manualPrices.mockReturnValue({
      data: [
        {
          symbol: "AAPL",
          price_date: "2026-09-15",
          price: "15",
          currency: "USD",
        },
      ],
      error: null,
      status: 200,
    });
    expect(await quoteOnDate(QUERY)).toBeNull();
  });

  it("is none for a day still to come, without reading", async () => {
    expect(await quoteOnDate({ ...QUERY, date: "2999-01-01" })).toBeNull();
    expect(quoteRead).not.toHaveBeenCalled();
    expect(lines.at(-1)).toMatchObject({
      "plant.ledger.action": "quote_on",
      "plant.outcome": "invalid",
    });
  });

  it("is none when the manual prices cannot be read", async () => {
    manualPrices.mockReturnValue({
      data: null,
      error: { code: "42501", message: "denied" },
      status: 403,
    });
    expect(await quoteOnDate(QUERY)).toBeNull();
    expect(lines.at(-1)).toMatchObject({ "plant.outcome": "failed" });
  });
});
