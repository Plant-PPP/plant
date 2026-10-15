jest.mock("server-only", () => ({}), { virtual: true });

import type { Database } from "@plant/shared";
import type { SupabaseClient } from "@supabase/supabase-js";

import { PAGE_ROW_LIMIT } from "@/lib/portfolio-setup/limits";

import {
  DebtsReadError,
  LIABILITY_EVENT_LIMIT,
  readLiabilities,
  readLiabilityEvents,
} from "./read";

const row = (id: string) => ({
  id,
  kind: "credit_card",
  label: "Visa",
  lender: null,
  currency: "ARS",
  uva: false,
  instrument_symbol: null,
  balance: "250000.00000000",
  installment: null,
  annual_rate: null,
  installments_left: null,
  next_due_on: null,
  matures_on: null,
  accrues: false,
  opened_on: null,
  anchored_on: "2026-10-01",
});

const clientWith = (result: unknown) => {
  const builder = {
    select: () => builder,
    order: () => builder,
    limit: async () => result,
  };
  return { from: () => builder } as unknown as SupabaseClient<Database>;
};

it("reads the user's debts with exact amounts", async () => {
  const view = await readLiabilities(
    clientWith({ data: [row("d1")], error: null, status: 200 }),
  );
  expect(view.active).toEqual([row("d1")]);
  expect(view.activeTruncated).toBe(false);
  expect(view.archived).toEqual([]);
});

it("cuts the list at the page limit and says so", async () => {
  const rows = Array.from({ length: PAGE_ROW_LIMIT + 1 }, (_, i) =>
    row(`d${i}`),
  );
  const view = await readLiabilities(
    clientWith({ data: rows, error: null, status: 200 }),
  );
  expect(view.active).toHaveLength(PAGE_ROW_LIMIT);
  expect(view.activeTruncated).toBe(true);
});

it("throws a failed read with its code", async () => {
  await expect(
    readLiabilities(
      clientWith({
        data: null,
        error: { code: "42501", message: "denied" },
        status: 403,
      }),
    ),
  ).rejects.toBeInstanceOf(DebtsReadError);
});

const eventRow = (n: number) => ({
  id: `e1000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  liability_id: n % 2 === 0 ? "d1" : "d2",
  kind: "payment",
  date: "2026-02-01",
  amount: "10.00000000",
  annual_rate: null,
  cash_holding_id: null,
  takes_cash: false,
  settles: false,
  created_at: `2026-02-01T00:00:00.${String(99999 - n).padStart(6, "0")}+00:00`,
});

// Serves `total` events newest first, one page per call, and records the
// filters each page asked for.
const eventsClient = (total: number) => {
  const rows = Array.from({ length: total }, (_, n) => eventRow(n));
  const pages: string[][] = [];
  let served = 0;
  const builder = {
    select: () => {
      pages.push([]);
      return builder;
    },
    eq: () => builder,
    lte: (_column: string, at: string) => {
      pages.at(-1)!.push(at);
      return builder;
    },
    or: (filter: string) => {
      pages.at(-1)!.push(filter);
      return builder;
    },
    order: () => builder,
    limit: async (size: number) => {
      const data = rows.slice(served, served + size);
      served += data.length;
      return { data, error: null, status: 200 };
    },
  };
  return {
    client: { from: () => builder } as unknown as SupabaseClient<Database>,
    pages,
  };
};

it("reads every debt event by keyset and groups them by debt", async () => {
  const { client, pages } = eventsClient(1500);
  const { byLiability, cut } = await readLiabilityEvents(client);
  expect(cut).toBe(false);
  expect(byLiability.get("d1")).toHaveLength(750);
  expect(byLiability.get("d2")).toHaveLength(750);
  expect(byLiability.get("d1")![0]).toMatchObject({ amount: "10.00000000" });
  // The second page starts after the first one's last event.
  const last = eventRow(999);
  expect(pages[0]).toEqual([]);
  expect(pages[1]![0]).toBe(last.created_at);
  expect(pages[1]![1]).toContain(last.id);
});

it("stops at the event limit and says the figures are cut", async () => {
  const { client } = eventsClient(LIABILITY_EVENT_LIMIT + 1000);
  const { byLiability, cut } = await readLiabilityEvents(client);
  expect(cut).toBe(true);
  expect(
    [...byLiability.values()].reduce((sum, each) => sum + each.length, 0),
  ).toBe(LIABILITY_EVENT_LIMIT);
});
