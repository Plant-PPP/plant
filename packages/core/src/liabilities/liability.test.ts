import { lastConstraint } from "@plant/shared/testing";

import type { QuoteSnapshot } from "../quotes/contract/quote";
import { liabilitiesToday } from "./history";
import {
  type Liability,
  liabilityInputSchema,
  liabilityQuotesNeeded,
  liabilityValue,
  principalSplit,
  valueLiabilities,
} from "./liability";

const SNAPSHOT: QuoteSnapshot = {
  date: "2026-10-12",
  fx: {
    mep: { sell: "1250", date: "2026-10-12" },
    uva: { sell: "1600.5", date: "2026-10-12" },
  },
  prices: { BTC: { price: "60000", currency: "USD", date: "2026-10-11" } },
};

const debt = (fields: Partial<Liability>): Liability => ({
  id: "d1",
  kind: "personal_loan",
  label: "Préstamo",
  lender: null,
  currency: "ARS",
  uva: false,
  instrument_symbol: null,
  balance: "1000",
  installment: null,
  annual_rate: null,
  installments_left: null,
  next_due_on: null,
  matures_on: null,
  accrues: false,
  opened_on: null,
  anchored_on: "2026-01-01",
  ...fields,
});

const value = (fields: Partial<Liability>, view: "ars" | "usd_mep" = "ars") => {
  const shown = liabilityValue(debt(fields), view, SNAPSHOT, "mep");
  return "missing" in shown ? shown : shown.value;
};

it("owes a UVA debt in pesos at the UVA of the day", () => {
  expect(value({ kind: "mortgage", uva: true, balance: "100" })).toEqual({
    n: 160050n,
    d: 1n,
  });
});

it("owes a dollar debt at the reference dollar in pesos", () => {
  expect(value({ kind: "usd_debt", currency: "USD", balance: "10" })).toEqual({
    n: 12500n,
    d: 1n,
  });
});

it("owes a crypto loan at its instrument's price", () => {
  expect(
    value(
      {
        kind: "crypto_loan",
        currency: null,
        instrument_symbol: "BTC",
        balance: "0.5",
      },
      "usd_mep",
    ),
  ).toEqual({ n: 30000n, d: 1n });
});

it("sums the debts and marks the sum incomplete without a quote", () => {
  const valued = valueLiabilities(
    liabilitiesToday(
      [
        debt({ id: "a" }),
        debt({ id: "b", uva: true }),
        debt({
          id: "c",
          kind: "crypto_loan",
          currency: null,
          instrument_symbol: "ETH",
        }),
      ],
      new Map(),
      SNAPSHOT.date,
    ),
    SNAPSHOT,
    { denominator: "ars", referenceDollar: "mep" },
  );
  expect(valued.total).toBe("1601500");
  expect(valued.complete).toBe(false);
  expect(valued.items[2]).toEqual({ id: "c", value: null, asOf: null });
});

it("refuses a unit that does not fit the kind", () => {
  const input = (fields: Partial<Liability>) => {
    const row: Partial<Liability> = debt(fields);
    delete row.id;
    delete row.anchored_on;
    return liabilityInputSchema.safeParse(row).success;
  };
  expect(input({})).toBe(true);
  expect(input({ currency: "USD", uva: true })).toBe(false);
  expect(input({ kind: "usd_debt" })).toBe(false);
  expect(
    input({ kind: "crypto_loan", currency: null, instrument_symbol: null }),
  ).toBe(false);
});

it("refuses a rate it cannot read instead of throwing", () => {
  const row: Partial<Liability> = debt({ annual_rate: "abc" });
  delete row.id;
  expect(liabilityInputSchema.safeParse(row).success).toBe(false);
  expect(
    liabilityInputSchema.safeParse({ ...row, annual_rate: "10.5" }).success,
  ).toBe(false);
});

it("leaves a debt with no currency unvalued, never as pesos", () => {
  expect(value({ currency: null })).toEqual({ missing: "currency" });
});

it("needs the UVA only for a UVA debt, and each loaned instrument's price", () => {
  const none = liabilityQuotesNeeded([]);
  expect(none.fxKinds).not.toContain("uva");
  const need = liabilityQuotesNeeded([
    { uva: true, instrument_symbol: null },
    { uva: false, instrument_symbol: "ETH" },
  ]);
  expect(need.fxKinds).toEqual([...none.fxKinds, "uva"]);
  expect(need.symbols).toEqual([...none.symbols, "ETH"]);
});

describe("accrual, as the liabilities CHECKs hold it", () => {
  it("pins the CHECKs accrualAgrees mirrors", () => {
    expect(lastConstraint("liabilities", "liabilities_accrues_opened")).toBe(
      "NOT accrues OR opened_on IS NOT NULL",
    );
    expect(lastConstraint("liabilities", "liabilities_accrues_fields")).toBe(
      "NOT accrues OR (installment IS NULL AND installments_left IS NULL\n                           AND next_due_on IS NULL)",
    );
    expect(lastConstraint("liabilities", "liabilities_card_plain")).toBe(
      "kind <> 'credit_card' OR NOT accrues",
    );
  });

  it.each([
    [{}, true],
    [{ accrues: true, opened_on: "2026-01-01" }, true],
    [{ accrues: true }, false],
    [{ accrues: true, opened_on: "2026-01-01", installment: "10" }, false],
    [{ accrues: true, opened_on: "2026-01-01", installments_left: 3 }, false],
    [
      { accrues: true, opened_on: "2026-01-01", next_due_on: "2026-11-01" },
      false,
    ],
    [
      { kind: "credit_card" as const, accrues: true, opened_on: "2026-01-01" },
      false,
    ],
  ])("takes %j: %s", (fields, valid) => {
    const row: Partial<Liability> = debt(fields);
    delete row.id;
    delete row.anchored_on;
    expect(liabilityInputSchema.safeParse(row).success).toBe(valid);
  });
});

it("values a paid-off debt at 0 without a quote", () => {
  const valued = valueLiabilities(
    liabilitiesToday(
      [
        debt({
          id: "c",
          kind: "crypto_loan",
          currency: null,
          instrument_symbol: "NOPE",
          balance: "1",
        }),
      ],
      new Map([
        [
          "c",
          [
            {
              id: "e1",
              liability_id: "c",
              kind: "payment",
              date: SNAPSHOT.date,
              amount: "1",
              annual_rate: null,
              cash_holding_id: null,
              takes_cash: false,
              settles: true,
              created_at: `${SNAPSHOT.date}T12:00:00Z`,
            },
          ],
        ],
      ]),
      SNAPSHOT.date,
    ),
    SNAPSHOT,
    { denominator: "ars", referenceDollar: "mep" },
  );
  expect(valued.complete).toBe(true);
  expect(valued.total).toBe("0");
});

it("takes a principal up to the balance", () => {
  const row: Partial<Liability> = debt({});
  delete row.id;
  delete row.anchored_on;
  const parse = (principal: string | null) =>
    liabilityInputSchema.safeParse({ ...row, principal }).success;
  expect(parse(null)).toBe(true);
  expect(parse("1000")).toBe(true);
  expect(parse("900.5")).toBe(true);
  expect(parse("1000.01")).toBe(false);
  expect(parse("0")).toBe(false);
});

it("splits what is owed into principal and interest", () => {
  expect(principalSplit("58501.09", "54719.05")).toEqual({
    principal: "54719.05",
    interest: "3782.04",
  });
  expect(principalSplit("500", "800")).toEqual({
    principal: "500",
    interest: "0",
  });
  expect(principalSplit("500", null)).toBeNull();
});

it("lets payments pay the principal first", () => {
  // 40.800 financed for a 34.000 property, 5.000 paid.
  expect(principalSplit("35800", "34000", "5000")).toEqual({
    principal: "29000",
    interest: "6800",
  });
  expect(principalSplit("2000", "34000", "38800")).toEqual({
    principal: "0",
    interest: "2000",
  });
});
