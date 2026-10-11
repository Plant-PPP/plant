import type { QuoteSnapshot } from "../quotes/contract/quote";
import {
  type Liability,
  liabilityInputSchema,
  liabilityValue,
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
