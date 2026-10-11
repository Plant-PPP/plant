jest.mock("server-only", () => ({}), { virtual: true });

import { QuoteStoreError } from "@plant/core";
import type { Database } from "@plant/shared";
import type { SupabaseClient } from "@supabase/supabase-js";

import { captureServerLog } from "@/lib/log/capture-server-log";
import { isLoggedError } from "@/lib/log/logged-error";
import type { ReadContext } from "@/lib/portfolio-setup/read";

import { assetsViewFailure } from "./assets-view";
import {
  INSTRUMENT_LIMIT,
  readHoldings,
  readInstruments,
  readReferenceDollar,
} from "./read";

const USER = "11111111-1111-4111-8111-111111111111";
const CONTEXT: ReadContext = {
  userId: USER,
  requestId: "12345678-aaaa-4bbb-8ccc-dddddddddddd",
  page: "/assets",
  params: {},
};

type Response = { data: unknown; error: unknown; status: number };

// Each from() answers the next response and records its calls.
function fakeClient(...responses: Response[]) {
  const calls: unknown[][][] = [];
  const client = {
    from: (table: string) => {
      const own: unknown[][] = [["from", table]];
      calls.push(own);
      const response = responses.shift();
      const builder: Record<string, unknown> = {
        then: (resolve: (value: Response) => unknown) => resolve(response!),
      };
      for (const method of [
        "select",
        "eq",
        "is",
        "not",
        "order",
        "limit",
        "single",
      ]) {
        builder[method] = (...args: unknown[]) => {
          own.push([method, ...args]);
          return builder;
        };
      }
      return builder;
    },
  };
  return { client: client as unknown as SupabaseClient<Database>, calls };
}

const ok = (data: unknown): Response => ({ data, error: null, status: 200 });

let lines: Record<string, unknown>[];
beforeEach(() => {
  lines = captureServerLog();
});
afterEach(() => jest.restoreAllMocks());

const HOLDING = {
  id: "h1",
  portfolio_id: "p1",
  asset_class: "cash",
  instrument_symbol: null,
  amount: "1234567.89",
  currency: "ARS",
  annual_rate: null,
  started_on: null,
  matures_on: null,
  valued_on: null,
  label: null,
  source_connection: {
    id: "a1",
    institution: "IOL",
  },
  portfolio: { id: "p1", name: "Largo plazo" },
};

describe("readHoldings", () => {
  it("selects amounts as text through the composite keys, by the user", async () => {
    const { client, calls } = fakeClient(ok([HOLDING]), ok([]));
    const view = await readHoldings(client, CONTEXT);
    expect(calls[0]).toContainEqual([
      "select",
      expect.stringContaining("amount:amount::text"),
    ]);
    const select = String(calls[0]!.find(([m]) => m === "select")![1]);
    expect(select).toContain("annual_rate:annual_rate::text");
    expect(select).toContain(
      "source_connections!holdings_user_id_source_connection_id_fkey",
    );
    expect(select).not.toContain("holders");
    expect(select).toContain(
      "portfolios!holdings_user_id_portfolio_id_fkey(id, name)",
    );
    expect(calls[0]).toContainEqual(["eq", "user_id", USER]);
    expect(view.active).toEqual([
      {
        id: "h1",
        holding: {
          id: "h1",
          portfolio_id: "p1",
          asset_class: "cash",
          instrument_symbol: null,
          amount: "1234567.89",
          currency: "ARS",
          annual_rate: null,
          started_on: null,
          matures_on: null,
          valued_on: null,
          label: null,
        },
        account: { id: "a1", institution: "IOL" },
        portfolio: { id: "p1", name: "Largo plazo" },
      },
    ]);
  });

  it("logs a row with a number amount by its column and throws", async () => {
    const { client } = fakeClient(
      ok([{ ...HOLDING, amount: 987654.32 }]),
      ok([]),
    );
    const error: unknown = await readHoldings(client, CONTEXT).catch(
      (e: unknown) => e,
    );
    expect(isLoggedError(error)).toBe(true);
    expect(lines[0]).toMatchObject({
      "plant.outcome": "invalid_row",
      "plant.portfolio_setup.columns": "amount",
      "plant.portfolio_setup.row_id": "h1",
    });
    expect(JSON.stringify(lines)).not.toContain("987654");
  });
});

describe("readInstruments", () => {
  it("reads one more than the limit and flags the cut", async () => {
    const instruments = Array.from(
      { length: INSTRUMENT_LIMIT + 1 },
      (_, i) => ({
        symbol: `S${i}`,
        name: `Símbolo ${i}`,
        currency: "USD",
      }),
    );
    const { client, calls } = fakeClient(ok(instruments));
    const read = await readInstruments(client, CONTEXT);
    expect(calls[0]).toContainEqual(["limit", INSTRUMENT_LIMIT + 1]);
    expect(read.rows).toHaveLength(INSTRUMENT_LIMIT);
    expect(read.truncated).toBe(true);
  });

  it("logs a failed read once and throws it as logged", async () => {
    const { client } = fakeClient({
      data: null,
      error: { code: "57014", message: "secret" },
      status: 500,
    });
    const error: unknown = await readInstruments(client, CONTEXT).catch(
      (e: unknown) => e,
    );
    expect(isLoggedError(error)).toBe(true);
    expect(lines).toEqual([
      expect.objectContaining({
        level: "error",
        event: "assets.view",
        "enduser.id": USER,
        "plant.page": "/assets",
        "plant.assets.read": "instruments",
        "plant.outcome": "error",
        "error.type": "57014",
      }),
    ]);
    expect(JSON.stringify(lines)).not.toContain("secret");
  });
});

describe("readReferenceDollar", () => {
  it("reads the user's profile", async () => {
    const { client, calls } = fakeClient(ok({ reference_dollar: "ccl" }));
    await expect(readReferenceDollar(client, CONTEXT)).resolves.toBe("ccl");
    expect(calls[0]).toContainEqual(["eq", "user_id", USER]);
  });

  it("logs a missing profile and throws", async () => {
    const { client } = fakeClient({
      data: null,
      error: { code: "PGRST116" },
      status: 406,
    });
    await expect(readReferenceDollar(client, CONTEXT)).rejects.toThrow(
      "assets.view_failed",
    );
    expect(lines[0]).toMatchObject({
      "plant.assets.read": "profile",
      "error.type": "PGRST116",
    });
  });
});

describe("assetsViewFailure", () => {
  it.each([
    [new QuoteStoreError("forbidden", "42501"), "forbidden", "42501"],
    [new RangeError("Quote range out of bounds"), "RangeError", undefined],
  ])("logs %s by its type", (error, type, storeCode) => {
    expect(() => assetsViewFailure(CONTEXT, "snapshot", error)).toThrow(
      "assets.view_failed",
    );
    expect(lines[0]).toMatchObject({
      "plant.assets.read": "snapshot",
      "error.type": type,
    });
    expect(lines[0]?.["plant.quotes.store_code"]).toBe(storeCode);
  });
});
