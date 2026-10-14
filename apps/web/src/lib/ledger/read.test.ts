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

// Each table answers its own response and records its calls; `sequence`
// records each request as it starts and each answer as it resolves.
// `afterPage` runs after each answer, to change the rows between two pages.
function fakeClient(
  responses: Record<string, Response>,
  afterPage: (table: string) => void = () => {},
) {
  const calls: Record<string, unknown[][]> = {};
  const sequence: string[] = [];
  const client = {
    from: (table: string) => {
      sequence.push(`from ${table}`);
      const own: unknown[][] = calls[table] ?? [];
      calls[table] = own;
      let range: [number, number] | undefined;
      let limit: number | undefined;
      let after: string | undefined;
      const builder: Record<string, unknown> = {
        // A paged read answers its page, as PostgREST does: by offset, or
        // by limit after the row a keyset filter names (rows sorted already).
        then: (resolve: (value: Response) => unknown) => {
          const response = responses[table]!;
          const rows = response.data;
          let data = rows;
          if (Array.isArray(rows) && range) {
            data = rows.slice(range[0], range[1] + 1);
          } else if (Array.isArray(rows) && limit !== undefined) {
            const start =
              after === undefined
                ? 0
                : rows.findIndex((row: { id: string }) => row.id === after) + 1;
            data = rows.slice(start, start + limit);
          }
          sequence.push(`answer ${table}`);
          const answered = resolve({ ...response, data });
          afterPage(table);
          return answered;
        },
        range: (from: number, to: number) => {
          own.push(["range", from, to]);
          range = [from, to];
          return builder;
        },
        limit: (rows: number) => {
          own.push(["limit", rows]);
          limit = rows;
          return builder;
        },
        or: (filter: string) => {
          own.push(["or", filter]);
          after = /id\.(?:gt|lt)\.([^,)]+)\)$/.exec(filter)?.[1];
          return builder;
        },
      };
      for (const method of ["select", "eq", "gte", "lte", "order"]) {
        builder[method] = (...args: unknown[]) => {
          own.push([method, ...args]);
          return builder;
        };
      }
      return builder;
    },
  };
  return {
    client: client as unknown as SupabaseClient<Database>,
    calls,
    sequence,
  };
}

const MOVEMENT_ROW = {
  id: "m1",
  holding_id: "h1",
  operation_id: "o1",
  entry_order: 4,
  rank: 4,
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
  created_at: "2026-10-01T12:00:00.123456+00:00",
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
  expect(calls.movements).toContainEqual(["limit", 1000]);
});

// Ids that sort as the page order does.
const movementRows = (count: number) =>
  Array.from({ length: count }, (_, n) => ({
    ...MOVEMENT_ROW,
    id: `m${String(n).padStart(5, "0")}`,
  }));

it("reads every page past PostgREST's cap on rows, each after the last row read", async () => {
  const { client, calls } = fakeClient(responses(movementRows(2_500)));
  const { ledger, truncated } = await readLedger(client, OPTIONS);
  expect(truncated).toBe(false);
  expect(ledger.movements.get("h1")).toHaveLength(2_500);
  expect(calls.movements!.filter(([method]) => method === "range")).toEqual([]);
  expect(calls.movements!.filter(([method]) => method === "or")).toEqual([
    [
      "or",
      "date.gt.2026-09-15,and(date.eq.2026-09-15,rank.gt.4),and(date.eq.2026-09-15,rank.eq.4,id.gt.m00999)",
    ],
    [
      "or",
      "date.gt.2026-09-15,and(date.eq.2026-09-15,rank.gt.4),and(date.eq.2026-09-15,rank.eq.4,id.gt.m01999)",
    ],
  ]);
  // A bound the index on date can use, alongside the keyset filter.
  expect(calls.movements!.filter(([method]) => method === "gte")).toEqual([
    ["gte", "date", "2026-09-15"],
    ["gte", "date", "2026-09-15"],
  ]);
});

it("neither repeats nor skips a movement when one is written between two pages", async () => {
  const rows = movementRows(2_500);
  let pages = 0;
  const { client } = fakeClient(responses(rows), (table) => {
    if (table === "movements" && ++pages === 1) {
      rows.unshift({ ...MOVEMENT_ROW, id: "m-new", date: "2026-01-02" });
    }
  });
  const { ledger } = await readLedger(client, OPTIONS);
  const ids = ledger.movements.get("h1")!.map((each) => each.id);
  expect(new Set(ids).size).toBe(ids.length);
  expect(ids.filter((id) => id !== "m-new")).toEqual(
    movementRows(2_500).map((each) => each.id),
  );
});

// Ids that sort as the page order does: newest first.
const holdingRows = (count: number) =>
  Array.from({ length: count }, (_, n) =>
    holdingRow(`h${String(count - n).padStart(5, "0")}`, "1.00000000"),
  );

it("pages the holdings after the last one read, not by offset", async () => {
  const { client, calls } = fakeClient({
    ...responses(),
    holdings: ok(holdingRows(2_500)),
  });
  const { ledger, truncated } = await readLedger(client, OPTIONS);
  expect(truncated).toBe(false);
  expect(ledger.revisions.size).toBe(2_500);
  expect(calls.holdings!.filter(([method]) => method === "range")).toEqual([]);
  expect(calls.holdings).toContainEqual(["limit", 1000]);
  const at = "2026-10-01T12:00:00.123456+00:00";
  expect(calls.holdings!.filter(([method]) => method === "or")).toEqual([
    ["or", `created_at.lt."${at}",and(created_at.eq."${at}",id.lt.h01501)`],
    ["or", `created_at.lt."${at}",and(created_at.eq."${at}",id.lt.h00501)`],
  ]);
  expect(calls.holdings!.filter(([method]) => method === "lte")).toEqual([
    ["lte", "created_at", at],
    ["lte", "created_at", at],
  ]);
});

it("neither repeats nor skips a holding when one is written between two pages", async () => {
  const rows = holdingRows(2_500);
  let pages = 0;
  const { client } = fakeClient(
    { ...responses(), holdings: ok(rows) },
    (table) => {
      if (table === "holdings" && ++pages === 1) {
        rows.unshift(holdingRow("h-new", "1.00000000"));
      }
    },
  );
  const { ledger } = await readLedger(client, OPTIONS);
  expect(ledger.holdings.map((each) => each.holding.id)).toEqual(
    holdingRows(2_500).map((each) => each.id),
  );
});

it("reads the revisions before the movements", async () => {
  const { client, sequence } = fakeClient(responses());
  await readLedger(client, OPTIONS);
  expect(sequence.indexOf("answer holdings")).toBeLessThan(
    sequence.indexOf("from movements"),
  );
});

it("says when the movements were cut", async () => {
  const { client } = fakeClient(
    responses(movementRows(LEDGER_MOVEMENT_LIMIT + 1)),
  );
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
