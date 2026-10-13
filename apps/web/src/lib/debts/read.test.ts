jest.mock("server-only", () => ({}), { virtual: true });

import type { Database } from "@plant/shared";
import type { SupabaseClient } from "@supabase/supabase-js";

import { PAGE_ROW_LIMIT } from "@/lib/portfolio-setup/limits";

import { DebtsReadError, readLiabilities } from "./read";

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
