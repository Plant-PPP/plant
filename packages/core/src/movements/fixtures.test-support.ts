import type { Movement, MovementRates, Trade } from "./movement";

// MEP 1200, CCL 1250 and official 1000 unless a test names other rates.
export const ratesOf = (
  date: string,
  { mep = "1200", ccl = "1250", official = "1000" } = {},
): MovementRates => ({
  mep: { sell: mep, date },
  ccl: { sell: ccl, date },
  official: { sell: official, date },
});

let next = 0;
const id = () => `m${String((next += 1)).padStart(5, "0")}`;

type Common = {
  id?: string;
  date: string;
  currency?: "ARS" | "USD";
  fees?: string;
  taxes?: string;
  rates?: MovementRates;
};

export function trade(
  kind: "opening_balance" | "purchase" | "sale",
  quantity: string,
  price: string,
  common: Common,
): Trade {
  return {
    id: common.id ?? id(),
    holding_id: "h1",
    kind,
    date: common.date,
    currency: common.currency ?? "USD",
    quantity,
    price,
    fees: common.fees ?? "0",
    taxes: common.taxes ?? "0",
    rates: common.rates ?? ratesOf(common.date),
  };
}

export function income(
  kind: "dividend" | "coupon",
  amount: string,
  common: Common,
): Movement {
  return {
    id: common.id ?? id(),
    holding_id: "h1",
    kind,
    date: common.date,
    currency: common.currency ?? "USD",
    amount,
    fees: common.fees ?? "0",
    taxes: common.taxes ?? "0",
    rates: common.rates ?? ratesOf(common.date),
  };
}
