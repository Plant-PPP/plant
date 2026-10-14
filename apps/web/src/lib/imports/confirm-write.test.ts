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
const ledgerFor = jest.fn();
jest.mock("@/lib/ledger/write", () => ({
  ...jest.requireActual("@/lib/ledger/write"),
  ledgerFor: (...args: unknown[]) => ledgerFor(...args),
}));
const importRead = jest.fn();
const cashRead = jest.fn();
const rpc = jest.fn();
jest.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc,
    from: (table: string) => {
      const builder = {
        select: () => builder,
        eq: () => builder,
        is: () => builder,
        limit: () => builder,
        then: (resolve: (value: unknown) => unknown) =>
          resolve(table === "holdings" ? cashRead() : importRead()),
      };
      return builder;
    },
  }),
}));

import { ACCOUNT, emptyLedger } from "@/lib/ledger/ledger-fixture.test-support";
import { captureServerLog } from "@/lib/log/capture-server-log";

import { confirmImportRows } from "./confirm-write";

const IMPORT = "a9000000-0000-4000-8000-0000000000a9";

const row = (symbol: string, quantity: string) => ({
  id: symbol,
  symbol,
  quantity,
  price: "18000",
  currency: "ARS",
  confidence: "high",
  source: "Página 1",
  discarded: false,
});

const ready = (
  status = "ready",
  document_date: string | null = "2026-09-15",
) => ({
  status: 200,
  error: null,
  data: [
    {
      id: IMPORT,
      status,
      document_date,
      document: { source_connection_id: ACCOUNT, file_name: "resumen.pdf" },
    },
  ],
});

let lines: Record<string, unknown>[];
beforeEach(() => {
  lines = captureServerLog();
  importRead.mockReset().mockReturnValue(ready());
  ledgerFor.mockReset().mockResolvedValue({
    ledger: emptyLedger(),
    truncated: false,
    symbolOf: new Map(),
  });
  rpc.mockReset().mockResolvedValue({ status: 200, data: IMPORT, error: null });
  cashRead.mockReset().mockReturnValue({ status: 200, error: null, data: [] });
});

const cash = (currency: "ARS" | "USD", quantity: string) => ({
  id: `cash-${currency}`,
  assetClass: "cash",
  symbol: currency,
  quantity,
  price: null,
  value: null,
  currency,
  confidence: "high",
  source: "Del documento",
  discarded: false,
});

describe("cash", () => {
  it("confirms a cash balance with the import's operations, against the cash read", async () => {
    cashRead.mockReturnValue({
      status: 200,
      error: null,
      data: [
        {
          id: "h1",
          source_connection_id: ACCOUNT,
          currency: "ARS",
          amount: "100.00000000",
        },
      ],
    });
    expect(
      await confirmImportRows(IMPORT, [
        row("AAPL", "5"),
        cash("USD", "812.4"),
        cash("ARS", "125000.5"),
      ]),
    ).toEqual({ ok: true, id: IMPORT });
    const [, args] = rpc.mock.calls[0]!;
    expect(args.p_operations).toEqual([
      expect.objectContaining({
        parts: [expect.objectContaining({ instrument_symbol: "AAPL" })],
      }),
      {
        cash: {
          source_connection_id: ACCOUNT,
          currency: "USD",
          amount: "812.4",
          expected: {},
        },
      },
      {
        cash: {
          source_connection_id: ACCOUNT,
          currency: "ARS",
          amount: "125000.5",
          expected: { h1: "100.00000000" },
        },
      },
    ]);
    expect(lines.at(-1)).toMatchObject({
      "plant.outcome": "ok",
      "plant.import.operation_count": 3,
    });
    expect(JSON.stringify(lines)).not.toContain("812.4");
  });

  it("leaves out a cash balance the review discarded", async () => {
    await confirmImportRows(IMPORT, [
      { ...cash("USD", "812.4"), discarded: true },
    ]);
    const [, args] = rpc.mock.calls[0]!;
    expect(args.p_operations).toEqual([]);
  });

  it.each([
    ["two balances in one currency", [cash("USD", "1"), cash("USD", "2")]],
    ["a balance that is not above zero", [cash("USD", "0")]],
    [
      "a balance in an account the review did not route",
      [{ ...cash("USD", "1"), accountLabel: "Caja de ahorro" }],
    ],
  ])("refuses %s, before writing", async (_, rows) => {
    expect(await confirmImportRows(IMPORT, rows)).toEqual({
      ok: false,
      code: "invalid",
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses a balance where the account holds several in that currency", async () => {
    cashRead.mockReturnValue({
      status: 200,
      error: null,
      data: ["h1", "h2"].map((id) => ({
        id,
        source_connection_id: ACCOUNT,
        currency: "USD",
        amount: "1.00000000",
      })),
    });
    expect(await confirmImportRows(IMPORT, [cash("USD", "5")])).toEqual({
      ok: false,
      code: "invalid",
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses a balance in an account that is not the user's", async () => {
    expect(
      await confirmImportRows(IMPORT, [
        { ...cash("USD", "5"), accountLabel: "Otra", accountId: "elsewhere" },
      ]),
    ).toEqual({ ok: false, code: "not_found" });
    expect(rpc).not.toHaveBeenCalled();
  });
});

it("confirms every operation with the import in one call", async () => {
  expect(await confirmImportRows(IMPORT, [row("AAPL", "5")])).toEqual({
    ok: true,
    id: IMPORT,
  });
  expect(ledgerFor).toHaveBeenCalledWith(expect.anything(), {
    date: "2026-09-15",
  });
  const [name, args] = rpc.mock.calls[0]!;
  expect(name).toBe("confirm_import");
  expect(args.p_import_id).toBe(IMPORT);
  expect(args.p_operations).toEqual([
    {
      parts: [
        expect.objectContaining({
          source_connection_id: ACCOUNT,
          instrument_symbol: "AAPL",
          kind: "opening_balance",
          date: "2026-09-15",
          quantity: "5",
          note: "Carga de resumen.pdf",
        }),
      ],
      expected: {},
    },
  ]);
  expect(lines.at(-1)).toMatchObject({
    event: "imports.confirm",
    "plant.outcome": "ok",
    "plant.import.operation_count": 1,
  });
  expect(JSON.stringify(lines)).not.toContain("18000");
});

it.each([
  ["one still being read", () => ready("reading")],
  ["one already confirmed", () => ready("confirmed")],
  [
    "one that is not the user's",
    () => ({ status: 200, error: null, data: [] }),
  ],
])("does not confirm %s", async (_, answer) => {
  importRead.mockReturnValue(answer());
  expect(await confirmImportRows(IMPORT, [row("AAPL", "5")])).toEqual({
    ok: false,
    code: "not_found",
  });
  expect(rpc).not.toHaveBeenCalled();
});

it("refuses rows the ledger would not admit, before writing", async () => {
  expect(
    await confirmImportRows(IMPORT, [row("AAPL", "5"), row("AAPL", "2")]),
  ).toEqual({ ok: false, code: "invalid" });
  expect(rpc).not.toHaveBeenCalled();
});

it.each([
  ["an id that is not one", "i1", []],
  ["rows that are not a list", IMPORT, "x"],
])("refuses %s", async (_, id, rows) => {
  expect(await confirmImportRows(id, rows)).toEqual({
    ok: false,
    code: "invalid",
  });
});

it("reads a race the database refused as a failure to retry", async () => {
  rpc.mockResolvedValue({
    status: 409,
    data: null,
    error: { code: "PT409", hint: "stale" },
  });
  expect(await confirmImportRows(IMPORT, [row("AAPL", "5")])).toEqual({
    ok: false,
    code: "failed",
  });
  expect(lines.at(-1)).toMatchObject({ level: "error" });
});

it("books a document dated later than today on today", async () => {
  importRead.mockReturnValue(ready("ready", "2999-01-01"));
  await confirmImportRows(IMPORT, []);
  const [, input] = ledgerFor.mock.calls[0]!;
  expect((input as { date: string }).date < "2999-01-01").toBe(true);
});
