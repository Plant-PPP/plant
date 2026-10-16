import {
  type Holding,
  holdingSchema,
  type Liability,
  type LiabilityEvent,
} from "@plant/core";
import { exactOf, minus, plus, stored } from "@plant/shared";

import { type Ledger, MANUAL, writeOperation } from "@/lib/ledger/ledger";
import {
  ACCOUNT,
  emptyLedger,
  PORTFOLIO,
} from "@/lib/ledger/ledger-fixture.test-support";

import {
  changeBetween,
  type ClosesState,
  closesOf,
  heldOn,
  skippedCashPayments,
} from "./compute";

const CASH: Holding = {
  id: "c0000000-0000-4000-8000-0000000000c0",
  portfolio_id: PORTFOLIO,
  asset_class: "cash",
  currency: "ARS",
  amount: "7000",
  instrument_symbol: null,
  annual_rate: null,
  started_on: null,
  matures_on: null,
  valued_on: null,
  label: null,
};

const loan = (fields: Partial<Liability> = {}): Liability => ({
  id: "d1",
  kind: "personal_loan",
  label: "Préstamo",
  lender: null,
  currency: "ARS",
  uva: false,
  instrument_symbol: null,
  balance: "50000",
  installment: null,
  annual_rate: null,
  installments_left: null,
  next_due_on: null,
  matures_on: null,
  accrues: false,
  opened_on: null,
  anchored_on: "2026-06-01",
  ...fields,
});

let seq = 0;
const event = (
  fields: Partial<LiabilityEvent> & Pick<LiabilityEvent, "kind" | "date">,
): LiabilityEvent => {
  seq += 1;
  return {
    id: `e${seq}`,
    liability_id: "d1",
    created_at: new Date(Date.UTC(2026, 0, 1) + seq * 1000).toISOString(),
    amount: null,
    annual_rate: null,
    cash_holding_id: null,
    takes_cash: false,
    settles: false,
    ...fields,
  } as LiabilityEvent;
};

const payment = (date: string, amount: string, fromCash: boolean) =>
  event({
    kind: "payment",
    date,
    amount,
    cash_holding_id: fromCash ? CASH.id : null,
    takes_cash: fromCash,
  });

// AAPL bought on 2026-05-04 at a price nothing moves, ARS cash, and `debts`
// with their events, seen on 2026-10-12.
function ledger(
  debts: Liability[],
  events: LiabilityEvent[],
  cash: Partial<Holding> = {},
  closed = false,
  date = "2026-05-04",
): ClosesState {
  const base = emptyLedger();
  const written = writeOperation(
    {
      ...base,
      quotes: {
        ...base.quotes,
        fxRates: [
          ...base.quotes.fxRates,
          ...(["mep", "ccl", "official"] as const).map((kind) => ({
            kind,
            rate_date: date,
            sell: "1000",
          })),
        ],
      },
    },
    {
      kind: "purchase",
      source_connection_id: ACCOUNT,
      instrument_symbol: "AAPL",
      date,
      currency: "ARS",
      price: "1000",
      charges: [],
      reference: null,
      note: null,
      parts: [{ portfolio_id: PORTFOLIO, quantity: "10" }],
    },
    { operationId: "op-1", newId: () => crypto.randomUUID() },
  );
  if (!written.result.ok) throw new Error(JSON.stringify(written.result));
  const state: Ledger = written.state;
  return {
    ...state,
    holdings: [
      ...state.holdings,
      {
        holding: holdingSchema.parse({ ...CASH, ...cash }),
        accountId: ACCOUNT,
        portfolioId: PORTFOLIO,
        closed,
        origin: MANUAL,
      },
    ],
    liabilities: debts,
    liabilityEvents: new Map([["d1", events]]),
    recalculated: new Map(),
    partial: false,
  };
}

const month = (state: ClosesState, period: string) =>
  closesOf(state, "ars").find((each) => each.period === period)!;
const cashOn = (state: ClosesState, date: string) =>
  heldOn(state, date).rows.find((row) => row.id === CASH.id)?.holding.amount;

describe("debts and cash in the closes", () => {
  it("values a debt at its balance on each day", () => {
    const state = ledger([loan()], [payment("2026-08-10", "1000", false)]);
    // 10 AAPL at 1000 and 7000 in cash, less what was owed.
    expect(month(state, "2026-07").figures.endValue).toBe("-33000");
    expect(month(state, "2026-08").figures.endValue).toBe("-32000");
  });

  it("gives cash back what a payment took after a day, so paying is neutral", () => {
    const state = ledger([loan()], [payment("2026-08-10", "1000", true)]);
    expect(cashOn(state, "2026-07-31")).toBe("8000");
    expect(cashOn(state, "2026-08-10")).toBe("7000");
    const august = month(state, "2026-08");
    expect(august.figures).toMatchObject({
      startValue: "-32000",
      endValue: "-32000",
      contributed: "0",
      market: "0",
      result: "0",
      share: "0",
    });
  });

  it("counts a payment from outside as money put in", () => {
    const state = ledger([loan()], [payment("2026-08-10", "1000", false)]);
    expect(cashOn(state, "2026-07-31")).toBe("7000");
    expect(month(state, "2026-08").figures).toMatchObject({
      contributed: "1000",
      market: "0",
      result: "0",
    });
  });

  it("counts a link that took no cash as money from outside", () => {
    const linked = event({
      kind: "payment",
      date: "2026-08-10",
      amount: "1000",
      cash_holding_id: CASH.id,
      takes_cash: false,
    });
    const state = ledger([loan()], [linked]);
    expect(cashOn(state, "2026-07-31")).toBe("7000");
    expect(month(state, "2026-08").figures.contributed).toBe("1000");
  });

  it("gives an emptied archived holding back only what payments took", () => {
    // Archiving keeps the amount the holding had before the last payment.
    const state = ledger(
      [loan()],
      [payment("2026-08-05", "600", true), payment("2026-08-10", "400", true)],
      { amount: "400" },
      true,
    );
    expect(cashOn(state, "2026-07-31")).toBe("1000");
    expect(cashOn(state, "2026-08-05")).toBe("400");
    expect(cashOn(state, "2026-08-10")).toBeUndefined();
    expect(month(state, "2026-08").figures.result).toBe("0");
  });

  it("restores nothing from a holding in another currency", () => {
    const state = ledger([loan()], [payment("2026-08-10", "1000", true)], {
      currency: "USD",
    });
    expect(skippedCashPayments(state)).toBe(1);
    expect(heldOn(state, "2026-07-31").rows).toHaveLength(2);
    expect(cashOn(state, "2026-07-31")).toBe("7000");
  });

  it("charges a month the interest a loan accrued, outside the market", () => {
    const state = ledger(
      [loan({ accrues: true, annual_rate: "0.12", opened_on: "2026-06-01" })],
      [],
    );
    const { figures } = month(state, "2026-08");
    const interest = exactOf(figures.interest);
    expect(interest.n > 0n).toBe(true);
    expect(figures.charges).toBe(figures.interest);
    expect(figures.market).toBe("0");
    expect(figures.result).toBe(stored(minus(exactOf("0"), interest)));
  });

  it("counts new principal as money taken out and a forgiven rest as put in", () => {
    const state = ledger(
      [loan()],
      [
        event({ kind: "adjustment", date: "2026-07-10", amount: "70000" }),
        event({
          kind: "payment",
          date: "2026-08-10",
          amount: "69900",
          settles: true,
        }),
      ],
    );
    expect(month(state, "2026-07").figures).toMatchObject({
      contributed: "-20000",
      market: "0",
    });
    // Paid 69 900 from outside and owed 70 000: the lender forgave 100.
    expect(month(state, "2026-08").figures).toMatchObject({
      contributed: "70000",
      market: "0",
    });
  });

  it("splits a change into parts that add up, interest apart", () => {
    const state = ledger(
      [loan({ accrues: true, annual_rate: "0.12", opened_on: "2026-06-01" })],
      [payment("2026-08-10", "1000", true)],
    );
    const change = changeBetween(state, "ars", "2026-06", "2026-09")!;
    expect(exactOf(change.interest).n < 0n).toBe(true);
    expect(
      stored(
        plus(
          exactOf(change.startValue),
          exactOf(change.contributed),
          exactOf(change.prices),
          exactOf(change.dollar),
          exactOf(change.yields),
          exactOf(change.interest),
        ),
      ),
    ).toBe(stored(exactOf(change.endValue)));
    expect(change.yields).toBe("0");
    expect(change.income).toBe("0");
  });

  it("marks every close incomplete when a read was cut", () => {
    const state = ledger([loan()], []);
    expect(closesOf(state, "ars").every((each) => each.complete)).toBe(true);
    const cut = { ...state, partial: true };
    expect(closesOf(cut, "ars").every((each) => !each.complete)).toBe(true);
  });

  it("charges exactly the month's accrual", () => {
    const state = ledger(
      [loan({ accrues: true, annual_rate: "0.12", opened_on: "2026-06-01" })],
      [],
    );
    // 50 000 × (1 + 0.12/365)^91 less the same over 60 days.
    expect(month(state, "2026-08").figures.interest).toBe("522.31");
    expect(changeBetween(state, "ars", "2026-08", "2026-08")!.interest).toBe(
      "-522.31",
    );
  });

  it("counts what settling an accruing loan for less forgave as put in", () => {
    const debt = loan({
      accrues: true,
      annual_rate: "0.12",
      opened_on: "2026-06-01",
    });
    const state = ledger(
      [debt],
      [
        event({
          kind: "payment",
          date: "2026-08-10",
          amount: "40000",
          settles: true,
        }),
      ],
    );
    const { figures } = month(state, "2026-08");
    // Only what accrued up to the settle is interest; what was owed then
    // was paid, 40 000 of it and the rest forgiven, as money put in.
    expect(figures.interest).toBe("167.91");
    expect(figures.contributed).toBe("51163.83");
    // Each part is valued to the cent, so a cent may be left over.
    expect(Math.abs(Number(figures.market))).toBeLessThanOrEqual(0.01);
  });

  it("counts a take it cannot give back as money from outside", () => {
    const gone = event({
      kind: "payment",
      date: "2026-08-10",
      amount: "1000",
      cash_holding_id: "c9000000-0000-4000-8000-0000000000c9",
      takes_cash: true,
    });
    const deleted = event({
      kind: "payment",
      date: "2026-08-12",
      amount: "500",
      cash_holding_id: null,
      takes_cash: true,
    });
    const state = ledger([loan()], [gone, deleted]);
    expect(skippedCashPayments(state)).toBe(2);
    expect(cashOn(state, "2026-07-31")).toBe("7000");
    expect(month(state, "2026-08").figures.contributed).toBe("1500");
  });

  it("gives one holding back what two debts took on the same day", () => {
    const other = loan({ id: "d2", balance: "1000" });
    const state: ClosesState = {
      ...ledger([loan(), other], []),
      liabilityEvents: new Map([
        ["d1", [payment("2026-08-10", "300", true)]],
        ["d2", [{ ...payment("2026-08-10", "700", true), liability_id: "d2" }]],
      ]),
    };
    expect(cashOn(state, "2026-08-09")).toBe("8000");
    expect(cashOn(state, "2026-08-10")).toBe("7000");
    expect(skippedCashPayments(state)).toBe(0);
    expect(month(state, "2026-08").figures.result).toBe("0");
  });

  it("leaves out an archived holding no payment took from", () => {
    const state = ledger([loan()], [], {}, true);
    expect(cashOn(state, "2026-07-31")).toBeUndefined();
  });

  it("keeps a closed placement at its amount", () => {
    const state = ledger(
      [],
      [],
      {
        asset_class: "fixed_term",
        annual_rate: "0.3",
        started_on: "2026-01-02",
        matures_on: "2026-07-01",
      },
      true,
    );
    expect(cashOn(state, "2026-03-31")).toBe("7000");
  });
});

describe("a dollar debt seen in pesos", () => {
  // 100 dollars owed, 10 of them paid on 2026-08-10 from 60 in cash, as the
  // dollar went from 1000 to 1100 pesos in August.
  function dollars(fromCash = true): ClosesState {
    const base = ledger(
      [loan({ kind: "usd_debt", currency: "USD", balance: "100" })],
      [payment("2026-08-10", "10", fromCash)],
      { currency: "USD", amount: "50" },
    );
    return {
      ...base,
      quotes: {
        ...base.quotes,
        fxRates: [
          ...base.quotes.fxRates,
          ...(["mep", "ccl", "official"] as const).flatMap((kind) => [
            { kind, rate_date: "2026-07-31", sell: "1000" },
            { kind, rate_date: "2026-08-31", sell: "1100" },
          ]),
        ],
      },
    };
  }

  it("puts only what was held and owed at the start in the dollar's part", () => {
    const state = dollars();
    // 10 AAPL at 1000 pesos, 60 dollars less 100 owed at the start.
    expect(month(state, "2026-08").figures).toMatchObject({
      startValue: "-30000",
      endValue: "-34000",
      contributed: "0",
      market: "-4000",
    });
    const change = changeBetween(state, "ars", "2026-08", "2026-08")!;
    expect(change).toMatchObject({
      dollar: "-4000",
      prices: "0",
      yields: "0",
      interest: "0",
    });
  });

  it("moves a debt with the dollar from its balance at the start", () => {
    // Paid from outside: cash stays at 50, the debt goes from 100 to 90.
    const state = dollars(false);
    expect(month(state, "2026-08").figures).toMatchObject({
      startValue: "-40000",
      endValue: "-34000",
      contributed: "11000",
      market: "-5000",
    });
    expect(changeBetween(state, "ars", "2026-08", "2026-08")).toMatchObject({
      dollar: "-5000",
      prices: "0",
      yields: "0",
      interest: "0",
    });
  });
});

it("closes ten years of debts at the event read's cap in a few seconds", () => {
  const debts = Array.from({ length: 10 }, (_, index) =>
    loan({
      id: `d${index}`,
      accrues: true,
      annual_rate: "0.12",
      balance: "100000000",
      anchored_on: "2016-01-01",
    }),
  );
  // 500 events each: a payment every week, a rate change every month.
  const events = new Map(
    debts.map((debt) => {
      const own: LiabilityEvent[] = [];
      for (let day = 0; own.length < 500; day += 7) {
        const date = new Date(Date.UTC(2016, 0, 2 + day))
          .toISOString()
          .slice(0, 10);
        own.push({
          ...payment(date, "1000", own.length % 2 === 0),
          liability_id: debt.id,
        });
        if (own.length % 4 === 0) {
          own.push({
            ...event({ kind: "rate_change", date, annual_rate: "0.1" }),
            liability_id: debt.id,
          } as LiabilityEvent);
        }
      }
      return [debt.id, own];
    }),
  );
  const state: ClosesState = {
    ...ledger(debts, [], { amount: "100000000" }, false, "2016-01-04"),
    liabilityEvents: events,
  };
  const started = performance.now();
  const closes = closesOf(state, "ars");
  changeBetween(state, "ars", closes[0]!.period, closes.at(-1)!.period);
  expect(closes.length).toBeGreaterThan(120);
  expect(performance.now() - started).toBeLessThan(5_000);
}, 60_000);
