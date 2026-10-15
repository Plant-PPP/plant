jest.mock("server-only", () => ({}), { virtual: true });
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
// Gain alerts' figures are worked out after each write; lib/alerts tests them.
const syncGainAlerts = jest.fn(async () => 0);
jest.mock("@/lib/alerts/read", () => ({
  syncGainAlerts: (...args: unknown[]) => syncGainAlerts(...(args as [])),
}));
jest.mock("@/lib/auth/session-claims", () => ({
  getSessionClaims: async () => ({ sub: "u1" }),
}));
jest.mock("@/lib/request-id-server", () => ({
  currentRequestId: async () => undefined,
}));
const quoteRead = jest.fn();
jest.mock("@/lib/quotes/quote-reader", () => ({
  MAX_ROWS: jest.requireActual("@/lib/quotes/quote-reader").MAX_ROWS,
  createQuoteReader: () => ({ read: quoteRead }),
}));
const rpc = jest.fn();
const manualPrices = jest.fn();
const transfersOf = jest.fn();
const deleted = jest.fn();
const instruments = jest.fn();
const filters: unknown[][] = [];
const inserts: [string, unknown][] = [];
jest.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc,
    from: (table: string) => {
      const builder = {
        select: () => builder,
        delete: () => builder,
        insert: (body: unknown) => (inserts.push([table, body]), builder),
        limit: () => builder,
        is: (...args: unknown[]) => (filters.push(["is", ...args]), builder),
        eq: (...args: unknown[]) => (filters.push(["eq", ...args]), builder),
        gte: (...args: unknown[]) => (filters.push(["gte", ...args]), builder),
        lte: (...args: unknown[]) => (filters.push(["lte", ...args]), builder),
        single: async () => ({
          data: { reference_dollar: "mep" },
          error: null,
          status: 200,
        }),
        then: (resolve: (value: unknown) => unknown) =>
          resolve(
            table === "movements"
              ? transfersOf()
              : table === "holdings"
                ? deleted()
                : table === "instruments"
                  ? instruments()
                  : manualPrices(),
          ),
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

import { addDays, daysBetween } from "@plant/shared";
import { revalidatePath } from "next/cache";
import { captureServerLog } from "@/lib/log/capture-server-log";
import { MAX_ROWS } from "@/lib/quotes/quote-reader";

import { suggestedTransferCost, writeOperation } from "./ledger";
import {
  ACCOUNT,
  emptyLedger,
  OTHER_PORTFOLIO,
  PORTFOLIO,
  PURCHASE,
} from "./ledger-fixture.test-support";
import {
  createInstrumentHolding,
  deleteHoldingRow,
  ledgerForDates,
  quoteOnDate,
  runOperation,
  setManualPrice,
  suggestTransferCost,
} from "./write";

const OPERATION = "0f000000-0000-4000-8000-00000000000f";

let lines: Record<string, unknown>[];
beforeEach(() => {
  lines = captureServerLog();
  syncGainAlerts.mockClear();
  rpc.mockReset();
  filters.length = 0;
  inserts.length = 0;
  instruments.mockReset().mockReturnValue({
    data: [{ currency: "ARS" }],
    error: null,
    status: 200,
  });
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
  // The movements changed, so the gain alerts' figures are worked out again.
  expect(syncGainAlerts).toHaveBeenCalledTimes(1);
});

it("refuses what core refuses without writing", async () => {
  const result = await runOperation("create_operation", null, {
    ...PURCHASE,
    kind: "sale",
  });
  expect(result.ok).toBe(false);
  expect(rpc).not.toHaveBeenCalled();
  expect(syncGainAlerts).not.toHaveBeenCalled();
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
  // The same day: it keeps its place.
  expect(args.p_last).toBe(false);
});

it("tells the database an edit moved to another day goes last there", async () => {
  const written = writeOperation(emptyLedger(), PURCHASE, {
    operationId: OPERATION,
    newId: () => crypto.randomUUID(),
  }).state;
  readLedger.mockResolvedValue({
    ledger: written,
    truncated: false,
    symbolOf: new Map(
      written.holdings.map((each) => [each.holding.id, "AAPL"]),
    ),
  });
  rpc.mockResolvedValue({ data: OPERATION, error: null, status: 200 });
  const result = await runOperation("update_operation", OPERATION, {
    ...PURCHASE,
    date: "2026-09-16",
  });
  expect(result).toEqual({ ok: true, id: OPERATION });
  expect(rpc.mock.calls[0]![1].p_last).toBe(true);
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
  [{ code: "PT409", hint: "negative_units" }, "oversold"],
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

describe("a manual price", () => {
  const INPUT = {
    symbol: "AAPL",
    price_date: "2026-09-15",
    price: "18100",
    currency: "ARS",
  };

  it("is stated in its instrument's currency", async () => {
    manualPrices.mockReturnValue({ data: null, error: null, status: 201 });
    expect(await setManualPrice(INPUT)).toEqual({ ok: true });
    expect(filters).toContainEqual(["eq", "symbol", "AAPL"]);
    expect(inserts).toEqual([["manual_prices", INPUT]]);
  });

  it("refuses a price in another currency than its instrument's", async () => {
    instruments.mockReturnValue({
      data: [{ currency: "USD" }],
      error: null,
      status: 200,
    });
    expect(await setManualPrice(INPUT)).toEqual({
      ok: false,
      code: "invalid",
    });
    expect(inserts).toEqual([]);
  });

  it("refuses an instrument the catalog does not list", async () => {
    instruments.mockReturnValue({ data: [], error: null, status: 200 });
    expect(await setManualPrice(INPUT)).toEqual({
      ok: false,
      code: "invalid",
    });
    expect(inserts).toEqual([]);
  });
});

describe("deleting a holding", () => {
  const HOLDING = "a9000000-0000-4000-8000-0000000000a9";
  beforeEach(() => {
    jest.mocked(revalidatePath).mockClear();
    transfersOf
      .mockReset()
      .mockReturnValue({ data: [], error: null, status: 200 });
    deleted
      .mockReset()
      .mockReturnValue({ data: [{ id: HOLDING }], error: null, status: 200 });
  });

  it("deletes it with its movements", async () => {
    expect(await deleteHoldingRow(HOLDING)).toEqual({ ok: true, id: HOLDING });
    expect(filters).toEqual([
      ["eq", "holding_id", HOLDING],
      ["eq", "kind", "transfer"],
      ["eq", "id", HOLDING],
    ]);
    expect(lines.at(-1)).toMatchObject({
      "plant.ledger.action": "delete_holding",
      "plant.outcome": "ok",
    });
  });

  it("refuses one with a transfer, without deleting", async () => {
    transfersOf.mockReturnValue({
      data: [{ id: "m" }],
      error: null,
      status: 200,
    });
    expect(await deleteHoldingRow(HOLDING)).toEqual({
      ok: false,
      code: "holding_has_transfers",
    });
    expect(deleted).not.toHaveBeenCalled();
  });

  it("refuses one a transfer reached after the check", async () => {
    deleted.mockReturnValue({
      data: null,
      error: {
        code: "PT409",
        message: "a holding with transfers is not deleted",
        hint: "holding_has_transfers",
      },
      status: 409,
    });
    expect(await deleteHoldingRow(HOLDING)).toEqual({
      ok: false,
      code: "holding_has_transfers",
    });
  });

  it("is not found when nothing was deleted", async () => {
    deleted.mockReturnValue({ data: [], error: null, status: 200 });
    expect(await deleteHoldingRow(HOLDING)).toEqual({
      ok: false,
      code: "not_found",
    });
    expect(revalidatePath).toHaveBeenCalledWith("/assets", "layout");
  });

  it("fails when the movements cannot be read", async () => {
    transfersOf.mockReturnValue({
      data: null,
      error: { code: "42501", message: "denied" },
      status: 403,
    });
    expect(await deleteHoldingRow(HOLDING)).toEqual({
      ok: false,
      code: "failed",
    });
    expect(deleted).not.toHaveBeenCalled();
  });

  it("refuses an id that is not one", async () => {
    expect(await deleteHoldingRow("x")).toEqual({ ok: false, code: "invalid" });
    expect(transfersOf).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("creating an instrument holding", () => {
  const HOLDING = "a9000000-0000-4000-8000-0000000000a9";
  const INPUT = {
    asset_class: "instrument",
    label: null,
    instrument_symbol: "AAPL",
    amount: "10",
    currency: null,
    annual_rate: null,
    started_on: null,
    matures_on: null,
    valued_on: null,
    source_connection_id: ACCOUNT,
    portfolio_id: PORTFOLIO,
  };
  const pricedToday = () => {
    const ledger = emptyLedger();
    return {
      ...ledger,
      quotes: {
        fxRates: ledger.quotes.fxRates.map((rate) => ({
          ...rate,
          rate_date: ledger.today,
        })),
        prices: [
          {
            symbol: "AAPL",
            price_date: ledger.today,
            price: "18000",
            currency: "ARS",
          },
        ],
      },
    };
  };
  beforeEach(() => {
    jest.mocked(revalidatePath).mockClear();
    deleted
      .mockReset()
      .mockReturnValue({ data: [{ id: HOLDING }], error: null, status: 200 });
  });

  it("opens it with its units at today's price", async () => {
    readLedger.mockResolvedValue({
      ledger: pricedToday(),
      truncated: false,
      symbolOf: new Map(),
    });
    rpc.mockResolvedValue({ data: OPERATION, error: null, status: 200 });
    expect(await createInstrumentHolding(INPUT)).toEqual({
      ok: true,
      id: HOLDING,
    });
    const [name, args] = rpc.mock.calls[0]!;
    expect(name).toBe("write_operation");
    expect(args.p_operation_id).toBeNull();
    expect(args.p_parts).toEqual([
      expect.objectContaining({
        kind: "opening_balance",
        instrument_symbol: "AAPL",
        portfolio_id: PORTFOLIO,
        quantity: "10",
        price: "18000",
        date: "2026-10-12",
      }),
    ]);
    expect(revalidatePath).toHaveBeenCalledWith("/assets", "layout");
  });

  it("refuses one without a price today, without writing", async () => {
    expect(await createInstrumentHolding(INPUT)).toEqual({
      ok: false,
      code: "invalid",
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses a holding of another class", async () => {
    expect(
      await createInstrumentHolding({
        ...INPUT,
        asset_class: "cash",
        instrument_symbol: null,
        currency: "ARS",
      }),
    ).toEqual({ ok: false, code: "invalid" });
    expect(readLedger).not.toHaveBeenCalled();
  });
});

describe("ledgerForDates", () => {
  it("reads the rates of days far apart in stretches the reader takes", async () => {
    quoteRead.mockClear();
    quoteRead.mockResolvedValue({ fxRates: [], prices: [] });
    readLedger.mockResolvedValue({ ledger: emptyLedger(), truncated: false });
    const { createClient } = jest.requireMock("@/lib/supabase/server");
    await ledgerForDates(await createClient(), [
      "2025-01-10",
      "2025-01-20",
      "2026-03-01",
      "2099-01-01",
    ]);
    expect(
      quoteRead.mock.calls.map(([range]) => [range.from, range.to]),
    ).toEqual([
      ["2025-01-03", "2025-01-20"],
      ["2026-02-22", "2026-03-01"],
    ]);
  });

  it("keeps every stretch of every rate kind under the reader's row cap", async () => {
    quoteRead.mockClear();
    quoteRead.mockResolvedValue({ fxRates: [], prices: [] });
    readLedger.mockResolvedValue({ ledger: emptyLedger(), truncated: false });
    const { createClient } = jest.requireMock("@/lib/supabase/server");
    const dates = Array.from({ length: 120 }, (_, index) =>
      addDays("2023-01-01", index * 9),
    );
    await ledgerForDates(await createClient(), dates);
    expect(quoteRead.mock.calls.length).toBeGreaterThan(1);
    for (const [range] of quoteRead.mock.calls) {
      expect(range.fxKinds).toEqual(["mep", "ccl", "official", "eur"]);
      expect(
        range.fxKinds.length * (daysBetween(range.from, range.to) + 1),
      ).toBeLessThanOrEqual(MAX_ROWS);
    }
  });
});
