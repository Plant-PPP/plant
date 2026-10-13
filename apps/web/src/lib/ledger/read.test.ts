jest.mock("server-only", () => ({}), { virtual: true });

import type { Database } from "@plant/shared";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  LEDGER_MOVEMENT_LIMIT,
  LedgerReadError,
  movementOfRow,
  readLedger,
} from "./read";

const ACCOUNT = "a5000000-0000-4000-8000-0000000000a5";
const PORTFOLIO = "a1000000-0000-4000-8000-0000000000a1";

type Response = { data: unknown; error: unknown; status: number };
const ok = (data: unknown): Response => ({ data, error: null, status: 200 });

// Each table answers its own response and records its calls.
function fakeClient(responses: Record<string, Response>) {
  const calls: Record<string, unknown[][]> = {};
  const client = {
    from: (table: string) => {
      const own: unknown[][] = calls[table] ?? [];
      calls[table] = own;
      let range: [number, number] | undefined;
      const builder: Record<string, unknown> = {
        // A paged read answers its page, as PostgREST does.
        then: (resolve: (value: Response) => unknown) => {
          const response = responses[table]!;
          return resolve(
            range && Array.isArray(response.data)
              ? {
                  ...response,
                  data: response.data.slice(range[0], range[1] + 1),
                }
              : response,
          );
        },
        range: (from: number, to: number) => {
          own.push(["range", from, to]);
          range = [from, to];
          return builder;
        },
      };
      for (const method of ["select", "eq", "order", "limit"]) {
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

const MOVEMENT_ROW = {
  id: "m1",
  holding_id: "h1",
  operation_id: "o1",
  entry_order: 4,
  kind: "purchase",
  date: "2026-09-15",
  currency: "ARS",
  direction: null,
  quantity: "5.00000000",
  price: "18000.00000000",
  amount: null,
  charges: [{ kind: "commission", label: null, amount: "90" }],
  reference: null,
  note: null,
  rates: {
    mep: { sell: "1200", date: "2026-09-14" },
    ccl: { sell: "1250", date: "2026-09-14" },
    official: { sell: "1000", date: "2026-09-14" },
  },
};

const holdingRow = (id: string, amount: string, archived = false) => ({
  id,
  source_connection_id: ACCOUNT,
  portfolio_id: PORTFOLIO,
  asset_class: "instrument",
  instrument_symbol: "AAPL",
  amount,
  currency: null,
  annual_rate: null,
  started_on: null,
  matures_on: null,
  valued_on: null,
  label: null,
  movements_revision: 2,
  archived_at: archived ? "2026-10-01T00:00:00Z" : null,
});

function responses(movements: unknown[] = [MOVEMENT_ROW]) {
  return {
    source_connections: ok([
      {
        id: ACCOUNT,
        institution: "IOL",
        include_in_tax_report: true,
        archived_at: null,
        portfolio: { id: PORTFOLIO, name: "Principal", archived_at: null },
      },
    ]),
    portfolios: ok([{ id: PORTFOLIO, name: "Principal", archived_at: null }]),
    holdings: ok([
      holdingRow("h1", "5.00000000"),
      holdingRow("h2", "0"),
      holdingRow("h3", "1.00000000", true),
    ]),
    movements: ok(movements),
    instruments: ok([
      { symbol: "AAPL", name: "Apple", currency: "ARS", type: "cedear" },
    ]),
    manual_prices: ok([]),
    manual_rates: ok([]),
  };
}

const OPTIONS = { today: "2026-10-12", referenceDollar: "mep" as const };

it("reads a movement by its kind's columns only", () => {
  const movement = movementOfRow(MOVEMENT_ROW);
  expect(movement).toEqual({
    id: "m1",
    holding_id: "h1",
    operation_id: "o1",
    entry_order: 4,
    kind: "purchase",
    date: "2026-09-15",
    currency: "ARS",
    quantity: "5.00000000",
    price: "18000.00000000",
    charges: [{ kind: "commission", label: null, amount: "90" }],
    reference: null,
    note: null,
    rates: MOVEMENT_ROW.rates,
  });
  expect(() =>
    movementOfRow({ ...MOVEMENT_ROW, charges: [{ kind: "bribe" }] }),
  ).toThrow();
});

it("builds the ledger from the user's rows", async () => {
  const { client, calls } = fakeClient(responses());
  const { ledger, truncated, symbolOf } = await readLedger(client, OPTIONS);
  expect(truncated).toBe(false);
  // Open and sold-out holdings; the archived one only by its revision.
  expect(ledger.holdings.map((each) => [each.holding.id, each.closed])).toEqual(
    [
      ["h1", false],
      ["h2", true],
    ],
  );
  expect(ledger.revisions).toEqual(
    new Map([
      ["h1", 2],
      ["h2", 2],
      ["h3", 2],
    ]),
  );
  expect(symbolOf.get("h3")).toBe("AAPL");
  expect(ledger.movements.get("h1")).toHaveLength(1);
  expect(ledger.nextEntryOrder).toBe(5);
  expect(ledger.accounts[0]).toEqual({
    id: ACCOUNT,
    institution: "IOL",
    includeInTaxReport: true,
    portfolio: { id: PORTFOLIO, name: "Principal", archived: false },
  });
  // Amounts as text, in core's order.
  expect(String(calls.movements![0]![1])).toContain("quantity:quantity::text");
  expect(calls.movements).toContainEqual(["order", "rank"]);
  expect(calls.movements).toContainEqual(["range", 0, 999]);
});

it("reads every page past PostgREST's cap on rows", async () => {
  const rows = Array.from({ length: 2_500 }, (_, n) => ({
    ...MOVEMENT_ROW,
    id: `m${n}`,
  }));
  const { client, calls } = fakeClient(responses(rows));
  const { ledger, truncated } = await readLedger(client, OPTIONS);
  expect(truncated).toBe(false);
  expect(ledger.movements.get("h1")).toHaveLength(2_500);
  expect(calls.movements!.filter(([method]) => method === "range")).toEqual([
    ["range", 0, 999],
    ["range", 1000, 1999],
    ["range", 2000, 2999],
  ]);
});

it("says when the movements were cut", async () => {
  const rows = Array.from({ length: LEDGER_MOVEMENT_LIMIT + 1 }, (_, n) => ({
    ...MOVEMENT_ROW,
    id: `m${n}`,
  }));
  const { client } = fakeClient(responses(rows));
  const { ledger, truncated } = await readLedger(client, OPTIONS);
  expect(truncated).toBe(true);
  expect(ledger.movements.get("h1")).toHaveLength(LEDGER_MOVEMENT_LIMIT);
});

it("fails naming the read that failed", async () => {
  const { client } = fakeClient({
    ...responses(),
    movements: { data: null, error: { code: "42501" }, status: 403 },
  });
  await expect(readLedger(client, OPTIONS)).rejects.toEqual(
    new LedgerReadError("movements", "42501"),
  );
});
