const requestHeaders = new Headers();
const getSessionClaims = jest.fn();
const createClient = jest.fn();
const revalidatePath = jest.fn();

jest.mock("server-only", () => ({}), { virtual: true });
jest.mock("next/headers", () => ({ headers: async () => requestHeaders }));
jest.mock("next/cache", () => ({
  revalidatePath: (path: string) => revalidatePath(path),
}));
jest.mock("@/lib/auth/session-claims", () => ({
  getSessionClaims: () => getSessionClaims(),
}));
jest.mock("@/lib/supabase/server", () => ({
  createClient: () => createClient(),
}));
const createInstrumentHolding = jest.fn();
jest.mock("@/lib/ledger/write", () => ({
  createInstrumentHolding: (input: unknown) => createInstrumentHolding(input),
  deleteHoldingRow: jest.fn(),
}));

import { captureServerLog } from "@/lib/log/capture-server-log";
import { without } from "@/test/without";

import {
  archiveHolding,
  createHolding,
  restoreHolding,
  updateHolding,
} from "./actions";

const USER = "11111111-1111-4111-8111-111111111111";
const ID = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";
const ACCOUNT = "a1000000-0000-4000-8000-0000000000a1";
const PORTFOLIO = "b1000000-0000-4000-8000-0000000000b1";
const REQUEST_ID = "12345678-aaaa-4bbb-8ccc-dddddddddddd";
const SENTINEL = "98765.4321";

type Response = {
  data: { id: string }[] | null;
  error: Record<string, unknown> | null;
  status: number;
};

function fakeClient(...responses: Response[]) {
  const calls: unknown[][] = [];
  const builder: Record<string, unknown> = {};
  for (const method of ["from", "insert", "update", "eq", "is", "not"]) {
    builder[method] = (...args: unknown[]) => {
      calls.push([method, ...args]);
      return builder;
    };
  }
  builder.select = (...args: unknown[]) => {
    calls.push(["select", ...args]);
    const response = responses.shift();
    if (!response) throw new Error("no response left");
    // A read filters after its select.
    const answer: Promise<Response> & Record<string, unknown> = Object.assign(
      Promise.resolve(response),
      {},
    );
    for (const method of ["eq", "limit"]) {
      answer[method] = (...args: unknown[]) => {
        calls.push([method, ...args]);
        return answer;
      };
    }
    return answer;
  };
  createClient.mockResolvedValue(builder);
  return calls;
}

const ok = (status = 200): Response => ({
  data: [{ id: ID }],
  error: null,
  status,
});
const refused = (status: number, code: string): Response => ({
  data: null,
  error: { code, message: SENTINEL, details: SENTINEL, hint: SENTINEL },
  status,
});

const NO_HISTORY: Response = { data: [], error: null, status: 200 };
const HISTORY_READ = [
  ["from", "cash_movements"],
  ["select", "id"],
  ["eq", "holding_id", ID],
  ["limit", 1],
];

const CASH = {
  asset_class: "cash",
  instrument_symbol: null,
  currency: "USD",
  amount: SENTINEL,
  annual_rate: null,
  started_on: null,
  matures_on: null,
  valued_on: null,
  label: null,
};

let lines: Record<string, unknown>[];

beforeEach(() => {
  jest.resetAllMocks();
  requestHeaders.set("x-request-id", REQUEST_ID);
  getSessionClaims.mockResolvedValue({ sub: USER });
  lines = captureServerLog();
});

afterEach(() => jest.restoreAllMocks());

function onlyLine() {
  expect(lines).toHaveLength(1);
  const [line] = lines;
  expect(JSON.stringify(line)).not.toContain(SENTINEL);
  if (line!["plant.outcome"] === "invalid") {
    expect(revalidatePath).not.toHaveBeenCalled();
  } else {
    expect(revalidatePath).toHaveBeenCalledWith("/assets");
  }
  return line!;
}

describe("createHolding", () => {
  it("inserts the parsed holding and revalidates the assets page", async () => {
    const calls = fakeClient(ok(201));
    await expect(
      createHolding({
        ...CASH,
        source_connection_id: ACCOUNT,
        portfolio_id: PORTFOLIO,
      }),
    ).resolves.toEqual({ ok: true, id: ID });
    expect(calls).toEqual([
      ["from", "holdings"],
      [
        "insert",
        { ...CASH, source_connection_id: ACCOUNT, portfolio_id: PORTFOLIO },
      ],
      ["select", "id"],
    ]);
    expect(onlyLine()).toMatchObject({
      "plant.portfolio_setup.action": "create_holding",
      "plant.outcome": "ok",
    });
  });

  it("refuses user_id, id or archived_at without a write", async () => {
    for (const extra of [
      { user_id: OTHER },
      { id: OTHER },
      { archived_at: "2000-01-01T00:00:00Z" },
    ]) {
      await expect(
        createHolding({
          ...CASH,
          source_connection_id: ACCOUNT,
          portfolio_id: PORTFOLIO,
          ...extra,
        }),
      ).resolves.toEqual({ ok: false, code: "invalid" });
    }
    expect(createClient).not.toHaveBeenCalled();
  });

  it("opens an instrument through the ledger, not with its amount", async () => {
    createInstrumentHolding.mockResolvedValue({ ok: true, id: ID });
    const input = {
      ...CASH,
      asset_class: "instrument",
      instrument_symbol: "BTC",
      currency: null,
      source_connection_id: ACCOUNT,
      portfolio_id: PORTFOLIO,
    };
    await expect(createHolding(input)).resolves.toEqual({ ok: true, id: ID });
    expect(createInstrumentHolding).toHaveBeenCalledWith(input);
    expect(createClient).not.toHaveBeenCalled();
  });

  it.each([
    ["another user's account or portfolio", 409, "23503"],
    ["a missing column", 400, "23502"],
  ])("fails on %s, logged by its code only", async (_label, status, code) => {
    fakeClient(refused(status, code));
    await expect(
      createHolding({
        ...CASH,
        source_connection_id: OTHER,
        portfolio_id: PORTFOLIO,
      }),
    ).resolves.toEqual({ ok: false, code: "failed" });
    expect(onlyLine()).toMatchObject({ level: "error", "error.type": code });
  });
});

describe("updateHolding", () => {
  const edit = without(CASH, "instrument_symbol");

  it("updates the columns of an active holding of that class, by the user", async () => {
    const calls = fakeClient(NO_HISTORY, ok());
    await expect(updateHolding(ID, edit)).resolves.toEqual({
      ok: true,
      id: ID,
    });
    const columns = without(edit, "asset_class");
    expect(calls).toEqual([
      ...HISTORY_READ,
      ["from", "holdings"],
      ["update", columns],
      ["eq", "user_id", USER],
      ["eq", "id", ID],
      ["eq", "asset_class", "cash"],
      ["is", "archived_at", null],
      ["select", "id"],
    ]);
    expect(onlyLine()).toMatchObject({
      "plant.portfolio_setup.action": "update_holding",
    });
  });

  it("never writes an instrument's units, which its movements leave", async () => {
    const calls = fakeClient(ok());
    await updateHolding(ID, {
      ...edit,
      asset_class: "instrument",
      currency: null,
    });
    expect(calls[1]).toEqual([
      "update",
      expect.not.objectContaining({ amount: expect.anything() }),
    ]);
  });

  it("never writes the amount of cash with a history, which its movements leave", async () => {
    const calls = fakeClient(ok(), ok());
    await updateHolding(ID, edit);
    expect(calls[HISTORY_READ.length + 1]).toEqual([
      "update",
      expect.not.objectContaining({ amount: expect.anything() }),
    ]);
  });

  it("moves a holding to another portfolio", async () => {
    const calls = fakeClient(NO_HISTORY, ok());
    await updateHolding(ID, { ...edit, portfolio_id: PORTFOLIO });
    expect(calls[HISTORY_READ.length + 1]).toEqual([
      "update",
      expect.objectContaining({ portfolio_id: PORTFOLIO }),
    ]);
  });

  it.each([
    [{ instrument_symbol: "ETH" }],
    [{ source_connection_id: OTHER }],
    [{ archived_at: null }],
    [{ user_id: OTHER }],
  ])("refuses %p without a write", async (extra) => {
    await expect(updateHolding(ID, { ...edit, ...extra })).resolves.toEqual({
      ok: false,
      code: "invalid",
    });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("refuses an id that is not one", async () => {
    await expect(updateHolding("x", edit)).resolves.toEqual({
      ok: false,
      code: "invalid",
    });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("reads no row as not_found", async () => {
    fakeClient(NO_HISTORY, { data: [], error: null, status: 200 });
    await expect(updateHolding(ID, edit)).resolves.toEqual({
      ok: false,
      code: "not_found",
    });
    onlyLine();
  });
});

it("archives an active holding of the user", async () => {
  const calls = fakeClient(ok());
  await expect(archiveHolding(ID)).resolves.toEqual({ ok: true, id: ID });
  expect(calls).toEqual([
    ["from", "holdings"],
    ["update", { archived_at: expect.any(String) }],
    ["eq", "user_id", USER],
    ["eq", "id", ID],
    ["is", "archived_at", null],
    ["select", "id"],
  ]);
  expect(onlyLine()).toMatchObject({
    "plant.portfolio_setup.action": "archive_holding",
  });
});

it("restores an archived holding of the user", async () => {
  const calls = fakeClient(ok());
  await expect(restoreHolding(ID)).resolves.toEqual({ ok: true, id: ID });
  expect(calls).toEqual([
    ["from", "holdings"],
    ["update", { archived_at: null }],
    ["eq", "user_id", USER],
    ["eq", "id", ID],
    ["not", "archived_at", "is", null],
    ["select", "id"],
  ]);
  expect(onlyLine()).toMatchObject({
    "plant.portfolio_setup.action": "restore_holding",
  });
});
