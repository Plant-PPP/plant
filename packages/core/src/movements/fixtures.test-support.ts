import type { Charge, Movement, MovementRates, Trade } from "./movement";

// MEP 1200, CCL 1250 and official 1000 unless a test names other rates.
export const ratesOf = (
  date: string,
  { mep = "1200", ccl = "1250", official = "1000" } = {},
): MovementRates => ({
  mep: { sell: mep, date },
  ccl: { sell: ccl, date },
  official: { sell: official, date },
});

// A commission and a tax, as a fixture writes them.
const chargesOf = ({ fees, taxes }: { fees?: string; taxes?: string }) => {
  const charges: Charge[] = [];
  if (fees && fees !== "0") {
    charges.push({ kind: "commission", label: null, amount: fees });
  }
  if (taxes && taxes !== "0") {
    charges.push({ kind: "tax", label: null, amount: taxes });
  }
  return charges;
};

let next = 0;

type Common = {
  id?: string;
  entry_order?: number;
  date: string;
  currency?: "ARS" | "USD" | "EUR";
  fees?: string;
  taxes?: string;
  rates?: MovementRates;
};

// A movement's identity and entry order: unless a test names them, each
// builder call is a new operation, entered after the previous one.
function stampOf(common: Common) {
  const n = (next += 1);
  const id = common.id ?? `m${String(n).padStart(5, "0")}`;
  return { id, operation_id: `op-${id}`, entry_order: common.entry_order ?? n };
}

export function trade(
  kind: "opening_balance" | "purchase" | "sale",
  quantity: string,
  price: string,
  common: Common,
): Trade {
  return {
    ...stampOf(common),
    holding_id: "h1",
    kind,
    date: common.date,
    currency: common.currency ?? "USD",
    quantity,
    price,
    charges: chargesOf(common),
    reference: null,
    note: null,
    rates: common.rates ?? ratesOf(common.date),
  };
}

export function income(
  kind: "dividend" | "coupon",
  amount: string,
  common: Common,
): Movement {
  return {
    ...stampOf(common),
    holding_id: "h1",
    kind,
    date: common.date,
    currency: common.currency ?? "USD",
    amount,
    charges: chargesOf(common),
    reference: null,
    note: null,
    rates: common.rates ?? ratesOf(common.date),
  };
}

export function adjustment(
  direction: "in" | "out",
  quantity: string,
  common: Common & { price?: string },
): Movement {
  return {
    ...stampOf(common),
    holding_id: "h1",
    kind: "adjustment",
    direction,
    date: common.date,
    currency: common.currency ?? "USD",
    quantity,
    price: common.price ?? "0",
    charges: chargesOf(common),
    reference: null,
    note: null,
    rates: common.rates ?? ratesOf(common.date),
  };
}

// One side of a transfer of units between holdings, in the operation `op`;
// `price` is a manual cost per unit for the side units arrive in, and `fees`
// its fee, on the side units leave.
export function transfer(
  direction: "in" | "out",
  quantity: string,
  common: Common & { holding: string; op: string; price?: string | null },
): Movement {
  return {
    ...stampOf(common),
    operation_id: common.op,
    entry_order: common.entry_order ?? 1000,
    holding_id: common.holding,
    kind: "transfer",
    direction,
    date: common.date,
    currency: common.currency ?? "USD",
    quantity,
    price: common.price ?? null,
    charges: chargesOf(common),
    reference: null,
    note: null,
    rates: common.rates ?? ratesOf(common.date),
  };
}

// Units a holding earned (in) or lost (out), each worth `price` that day.
export function yielded(
  direction: "in" | "out",
  quantity: string,
  price: string,
  common: Common,
): Movement {
  return {
    ...stampOf(common),
    holding_id: "h1",
    kind: "yield",
    direction,
    date: common.date,
    currency: common.currency ?? "USD",
    quantity,
    price,
    charges: [],
    reference: null,
    note: null,
    rates: common.rates ?? ratesOf(common.date),
  };
}
