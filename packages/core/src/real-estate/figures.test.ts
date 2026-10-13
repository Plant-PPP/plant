import { exactOf } from "@plant/shared";

import type { QuoteSnapshot } from "../quotes/contract/quote";
import { realEstateFigures, type RealEstateTerms } from "./figures";

const SNAPSHOT: QuoteSnapshot = {
  date: "2026-10-12",
  fx: {
    mep: { sell: "1000", date: "2026-10-12" },
    ccl: { sell: "1050", date: "2026-10-12" },
    official: { sell: "900", date: "2026-10-12" },
    uva: { sell: "1500", date: "2026-10-12" },
  },
  prices: {},
};

const usd = (amount: string) => ({
  amount: exactOf(amount),
  currency: "USD" as const,
});
const ars = (amount: string) => ({
  amount: exactOf(amount),
  currency: "ARS" as const,
});

// A flat worth US$ 95.000, bought for US$ 82.000, rented for $ 650.000 a
// month, with $ 120.000 of expenses and a UVA mortgage of 312,4 UVA a month.
const RENTED: RealEstateTerms = {
  value: usd("95000"),
  purchase: usd("82000"),
  monthlyRent: ars("650000"),
  monthlyExpenses: ars("120000"),
  debt: {
    currency: "ARS",
    uva: true,
    instrument_symbol: null,
    installment: "312.4",
  },
};

it("matches the sheet worked out by hand, in pesos", () => {
  expect(realEstateFigures(RENTED, "ars", SNAPSHOT, "mep")).toEqual({
    netMonthly: "61400",
    rentalYield: "0.066947",
    appreciation: { amount: "13000000", share: "0.158537" },
  });
});

it("gives the same yield and appreciation share in dollars", () => {
  const figures = realEstateFigures(RENTED, "usd_mep", SNAPSHOT, "mep");
  expect(figures.rentalYield).toBe("0.066947");
  expect(figures.appreciation).toEqual({ amount: "13000", share: "0.158537" });
  expect(figures.netMonthly).toBe("61.4");
});

it("has no yield without rent, and what it costs a month without it", () => {
  const home = realEstateFigures(
    { ...RENTED, monthlyRent: null },
    "ars",
    SNAPSHOT,
    "mep",
  );
  expect(home.rentalYield).toBeNull();
  expect(home.netMonthly).toBe("-588600");
});

it("has no appreciation without a purchase price", () => {
  expect(
    realEstateFigures({ ...RENTED, purchase: null }, "ars", SNAPSHOT, "mep")
      .appreciation,
  ).toBeNull();
});

it("leaves out a figure whose quote is missing", () => {
  const noUva = { ...SNAPSHOT, fx: { ...SNAPSHOT.fx, uva: undefined } };
  const figures = realEstateFigures(RENTED, "ars", noUva, "mep");
  expect(figures.netMonthly).toBeNull();
  expect(figures.rentalYield).toBe("0.066947");
});
