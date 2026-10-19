import { type CashMovement, type Holding, holdingSchema } from "@plant/core";

import { type Ledger, MANUAL, writeOperation } from "@/lib/ledger/ledger";
import {
  ACCOUNT,
  emptyLedger,
  PORTFOLIO,
} from "@/lib/ledger/ledger-fixture.test-support";

import { changeBetween, type ClosesState, closesOf, heldOn } from "./compute";

const CASH: Holding = {
  id: "c0000000-0000-4000-8000-0000000000c0",
  portfolio_id: PORTFOLIO,
  asset_class: "cash",
  currency: "ARS",
  amount: "40550",
  instrument_symbol: null,
  annual_rate: null,
  started_on: null,
  matures_on: null,
  valued_on: null,
  label: null,
};

const RATES = Object.fromEntries(
  (["mep", "ccl", "official"] as const).map((kind) => [
    kind,
    { sell: "1000", date: "2026-09-01" },
  ]),
) as CashMovement["rates"];

const common = {
  source_connection_id: ACCOUNT,
  instrument_symbol: "AAPL",
  currency: "ARS",
  reference: null,
  note: null,
};

// In an account whose pesos have a history: 1000 held before it, 100 000
// deposited, 10 AAPL bought at 9000 with 500 of charges, a dividend of 300
// less 50, 5 sold at 10 000 less 200 and 20 000 withdrawn, each paid or
// collected in that cash; `settle` leaves the operations' legs out.
function ledger(settle = true): ClosesState {
  const base = emptyLedger();
  let state: Ledger = {
    ...base,
    quotes: {
      ...base.quotes,
      fxRates: [
        "2026-08-31",
        "2026-09-07",
        "2026-09-14",
        "2026-09-21",
        "2026-09-28",
        "2026-10-05",
        "2026-10-12",
      ].flatMap((date) =>
        (["mep", "ccl", "official"] as const).map((kind) => ({
          kind,
          rate_date: date,
          sell: "1000",
        })),
      ),
    },
  };
  const operations = [
    {
      id: "op-buy",
      kind: "purchase",
      date: "2026-09-15",
      price: "9000",
      charges: [{ kind: "commission", label: null, amount: "500" }],
      parts: [{ portfolio_id: PORTFOLIO, quantity: "10" }],
    },
    {
      id: "op-dividend",
      kind: "dividend",
      date: "2026-10-05",
      charges: [{ kind: "tax", label: null, amount: "50" }],
      parts: [{ portfolio_id: PORTFOLIO, amount: "300" }],
    },
    {
      id: "op-sale",
      kind: "sale",
      date: "2026-10-10",
      price: "10000",
      charges: [{ kind: "commission", label: null, amount: "200" }],
      parts: [{ portfolio_id: PORTFOLIO, quantity: "5" }],
    },
  ];
  for (const { id, ...operation } of operations) {
    const written = writeOperation(
      state,
      { ...common, ...operation },
      { operationId: id, newId: () => crypto.randomUUID() },
    );
    if (!written.result.ok) throw new Error(JSON.stringify(written.result));
    state = written.state;
  }
  const movement = (
    kind: CashMovement["kind"],
    date: string,
    amount: string,
    operation: string | null = null,
  ): CashMovement => ({
    id: `${kind}-${date}`,
    holding_id: CASH.id,
    operation_id: operation,
    kind,
    date,
    amount,
    reference: null,
    note: null,
    rates: RATES,
  });
  const history = [
    movement("opening_balance", "2026-09-01", "1000"),
    movement("deposit", "2026-09-01", "100000"),
    ...(settle
      ? [
          movement("settlement", "2026-09-15", "-90500", "op-buy"),
          movement("settlement", "2026-10-05", "250", "op-dividend"),
          movement("settlement", "2026-10-10", "49800", "op-sale"),
        ]
      : []),
    movement("withdrawal", "2026-10-11", "-20000"),
  ];
  return {
    ...state,
    holdings: [
      ...state.holdings,
      {
        holding: holdingSchema.parse({
          ...CASH,
          amount: settle ? CASH.amount : "81000",
        }),
        accountId: ACCOUNT,
        portfolioId: PORTFOLIO,
        closed: false,
        origin: MANUAL,
      },
    ],
    liabilities: [],
    liabilityEvents: new Map(),
    cashMovements: new Map([[CASH.id, history]]),
    recalculated: new Map(),
    partial: false,
  };
}

const month = (state: ClosesState, period: string) =>
  closesOf(state, "ars").find((each) => each.period === period)!;

describe("cash with a history in the closes", () => {
  it("values cash at each day's balance, its opening before it", () => {
    const state = ledger();
    const cashOn = (date: string) =>
      heldOn(state, date).rows.find((row) => row.id === CASH.id)?.holding
        .amount;
    expect(cashOn("2026-08-31")).toBe("1000");
    expect(cashOn("2026-09-15")).toBe("10500");
    expect(cashOn("2026-10-12")).toBe("40550");
  });

  it("counts deposits and withdrawals as the money put in, trades as moves", () => {
    const state = ledger();
    expect(closesOf(state, "ars")[0]!.period).toBe("2026-09");
    expect(month(state, "2026-09").figures).toMatchObject({
      startValue: "1000",
      endValue: "100500",
      paidIn: "100000",
      proceeds: "0",
      contributed: "100000",
      charges: "500",
      kept: "-500",
      market: "0",
      result: "-500",
    });
    expect(month(state, "2026-10").figures).toMatchObject({
      startValue: "100500",
      endValue: "90550",
      paidIn: "0",
      proceeds: "20000",
      contributed: "-20000",
      income: "300",
      charges: "250",
      kept: "50",
      market: "10000",
      result: "10050",
    });
  });

  it("splits the change into parts that add up to it", () => {
    const change = changeBetween(ledger(), "ars", "2026-09", "2026-10")!;
    expect(change).toMatchObject({
      startValue: "1000",
      endValue: "90550",
      contributed: "80000",
      prices: "10000",
      dollar: "0",
      yields: "0",
      kept: "-450",
    });
  });

  it("keeps an operation with no cash leg as money from outside", () => {
    const state = ledger(false);
    expect(month(state, "2026-09").figures).toMatchObject({
      contributed: "190000",
      charges: "500",
      kept: "0",
    });
  });
});
