import { readFileSync } from "node:fs";
import { join } from "node:path";

import { repoRoot } from "@/test/supabase-config";
import { without } from "@/test/without";

import { holdingInsertSchema, holdingUpdateSchema } from "./schemas";

const ACCOUNT = "a1000000-0000-4000-8000-0000000000a1";
const PORTFOLIO = "b1000000-0000-4000-8000-0000000000b1";

const empty = {
  instrument_symbol: null,
  currency: null,
  annual_rate: null,
  started_on: null,
  matures_on: null,
  valued_on: null,
  label: null,
};

// One valid holding of each class, as the dialog sends it.
const SAMPLES = {
  instrument: {
    ...empty,
    asset_class: "instrument",
    instrument_symbol: "BTC",
    amount: "0.5",
  },
  cash: {
    ...empty,
    asset_class: "cash",
    currency: "USD",
    amount: "1500",
    label: "Caja",
  },
  fixed_term: {
    ...empty,
    asset_class: "fixed_term",
    currency: "ARS",
    amount: "100000",
    annual_rate: "0.35",
    started_on: "2026-10-01",
    matures_on: "2026-10-31",
  },
  real_estate: {
    ...empty,
    asset_class: "real_estate",
    currency: "USD",
    amount: "90000",
    valued_on: "2026-10-01",
    label: "Depto",
  },
  other: {
    ...empty,
    asset_class: "other",
    currency: "ARS",
    amount: "3000000",
    valued_on: "2026-10-01",
    label: "Auto",
  },
} as const;
const CLASSES = Object.keys(SAMPLES) as (keyof typeof SAMPLES)[];

const insert = (c: keyof typeof SAMPLES, extra: object = {}) => ({
  ...SAMPLES[c],
  source_connection_id: ACCOUNT,
  portfolio_id: PORTFOLIO,
  ...extra,
});
const update = (c: keyof typeof SAMPLES, extra: object = {}) => {
  return { ...without(SAMPLES[c], "instrument_symbol"), ...extra };
};

// The column grants the pgTAP ACL pin asserts, by verb.
function granted(verb: "INSERT" | "UPDATE"): string[] {
  const sql = readFileSync(
    join(repoRoot, "supabase/tests/holdings_isolation_test.sql"),
    "utf8",
  );
  const pin = sql.slice(sql.indexOf("pg_temp.acl('public.holdings')"));
  const block = pin.slice(0, pin.indexOf("]"));
  return [...block.matchAll(/'(\w+):(INSERT|UPDATE)'/g)]
    .filter(([, , v]) => v === verb)
    .map(([, column]) => column!);
}

describe.each(CLASSES)("a %s holding", (c) => {
  it("is valid to insert and to update", () => {
    expect(holdingInsertSchema.safeParse(insert(c)).success).toBe(true);
    expect(holdingUpdateSchema.safeParse(update(c)).success).toBe(true);
    expect(
      holdingUpdateSchema.safeParse(update(c, { portfolio_id: PORTFOLIO }))
        .success,
    ).toBe(true);
  });

  it("refuses unknown keys such as user_id and id", () => {
    expect(
      holdingInsertSchema.safeParse(insert(c, { user_id: ACCOUNT })).success,
    ).toBe(false);
    expect(
      holdingUpdateSchema.safeParse(update(c, { id: ACCOUNT })).success,
    ).toBe(false);
  });

  it("refuses an update of the account or the instrument", () => {
    expect(
      holdingUpdateSchema.safeParse(
        update(c, { source_connection_id: ACCOUNT }),
      ).success,
    ).toBe(false);
    expect(
      holdingUpdateSchema.safeParse(update(c, { instrument_symbol: "ETH" }))
        .success,
    ).toBe(false);
  });

  it("writes only granted columns", () => {
    const insertColumns = granted("INSERT");
    const updateColumns = granted("UPDATE").filter(
      (col) => col !== "archived_at",
    );
    expect(insertColumns.length).toBeGreaterThan(0);
    const branchKeys = (
      schema: typeof holdingInsertSchema | typeof holdingUpdateSchema,
    ) =>
      Object.keys(
        schema.options.find((o) => o.shape.asset_class.value === c)!.shape,
      );
    expect(insertColumns).toEqual(
      expect.arrayContaining(branchKeys(holdingInsertSchema)),
    );
    expect(updateColumns).toEqual(
      expect.arrayContaining(
        branchKeys(holdingUpdateSchema).filter((key) => key !== "asset_class"),
      ),
    );
  });
});

it("refuses a value in a column the class has not", () => {
  expect(
    holdingInsertSchema.safeParse(insert("instrument", { currency: "USD" }))
      .success,
  ).toBe(false);
});

it("refuses a fixed term maturing before it starts", () => {
  expect(
    holdingUpdateSchema.safeParse(
      update("fixed_term", { matures_on: "2026-09-30" }),
    ).success,
  ).toBe(false);
});

it("trims a label", () => {
  const parsed = holdingInsertSchema.parse(
    insert("real_estate", { label: "  Depto " }),
  );
  expect(parsed.label).toBe("Depto");
});

it.each([
  ["   ", false],
  ["a".repeat(80), true],
  ["a".repeat(81), false],
])("checks a label %#", (label, valid) => {
  expect(
    holdingInsertSchema.safeParse(insert("real_estate", { label })).success,
  ).toBe(valid);
});

it("takes a cash label as null, never missing", () => {
  expect(
    holdingInsertSchema.safeParse(insert("cash", { label: null })).success,
  ).toBe(true);
  expect(
    holdingInsertSchema.safeParse(without(insert("cash"), "label")).success,
  ).toBe(false);
});
