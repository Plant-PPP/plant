jest.mock("server-only", () => ({}), { virtual: true });

import type { Database } from "@plant/shared";
import type { SupabaseClient } from "@supabase/supabase-js";

import { readOtherHoldings } from "./read";

const AT = "2026-10-01T12:00:00.123456+00:00";

// Ids that sort as the page order does: newest first.
const holdingRows = (count: number) =>
  Array.from({ length: count }, (_, n) =>
    cashRow(`c${String(count - n).padStart(5, "0")}`),
  );

function cashRow(id: string) {
  return {
    id,
    created_at: AT,
    portfolio_id: "p1",
    asset_class: "cash",
    instrument_symbol: null,
    amount: "100.00",
    currency: "ARS",
    annual_rate: null,
    started_on: null,
    matures_on: null,
    valued_on: null,
    label: null,
    source_connection: { id: "a1", institution: "Banco" },
    portfolio: { id: "p1", name: "Principal" },
    instrument: null,
  };
}

// Answers a page as PostgREST does: by offset, or by limit after the row a
// keyset filter names. `afterPage` runs after each answer.
function fakeClient(
  rows: Record<string, unknown>[],
  afterPage: () => void = () => {},
) {
  const calls: unknown[][] = [];
  const client = {
    from: () => {
      let range: [number, number] | undefined;
      let limit: number | undefined;
      let after: string | undefined;
      const builder: Record<string, unknown> = {
        then: (resolve: (value: unknown) => unknown) => {
          let data = rows;
          if (range) data = rows.slice(range[0], range[1] + 1);
          else if (limit !== undefined) {
            const start =
              after === undefined
                ? 0
                : rows.findIndex((row) => row.id === after) + 1;
            data = rows.slice(start, start + limit);
          }
          const answered = resolve({ data, error: null, status: 200 });
          afterPage();
          return answered;
        },
        range: (from: number, to: number) => {
          calls.push(["range", from, to]);
          range = [from, to];
          return builder;
        },
        limit: (count: number) => {
          calls.push(["limit", count]);
          limit = count;
          return builder;
        },
        or: (filter: string) => {
          calls.push(["or", filter]);
          after = /id\.lt\.([^,)]+)\)$/.exec(filter)?.[1];
          return builder;
        },
      };
      for (const method of ["select", "neq", "is", "lte", "order"]) {
        builder[method] = (...args: unknown[]) => {
          calls.push([method, ...args]);
          return builder;
        };
      }
      return builder;
    },
  };
  return { client: client as unknown as SupabaseClient<Database>, calls };
}

it("pages the holdings after the last one read, not by offset", async () => {
  const { client, calls } = fakeClient(holdingRows(2_500));
  const { rows, truncated } = await readOtherHoldings(client);
  expect(truncated).toBe(false);
  expect(rows).toHaveLength(2_500);
  expect(calls.filter(([method]) => method === "range")).toEqual([]);
  expect(calls.filter(([method]) => method === "or")).toEqual([
    ["or", `created_at.lt."${AT}",and(created_at.eq."${AT}",id.lt.c01501)`],
    ["or", `created_at.lt."${AT}",and(created_at.eq."${AT}",id.lt.c00501)`],
  ]);
  expect(calls.filter(([method]) => method === "lte")).toEqual([
    ["lte", "created_at", AT],
    ["lte", "created_at", AT],
  ]);
});

it("neither repeats nor skips a holding when one is written between two pages", async () => {
  const rows: Record<string, unknown>[] = holdingRows(2_500);
  let pages = 0;
  const { client } = fakeClient(rows, () => {
    if (++pages === 1) rows.unshift(cashRow("c-new"));
  });
  const read = await readOtherHoldings(client);
  expect(read.rows.map((each) => each.id)).toEqual(
    holdingRows(2_500).map((each) => each.id),
  );
});
