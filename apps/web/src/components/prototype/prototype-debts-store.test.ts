import { liabilitiesToday, valueLiabilities } from "@plant/core";

import { buildFixtures } from "@/lib/prototype/fixtures";

import {
  createLiability,
  deleteLiability,
  deleteLiabilityEvent,
  setCollateral,
  updateLiability,
  writeLiabilityEvent,
} from "./prototype-debts-store";
import { initialState } from "./prototype-store";

const TODAY = "2026-10-12";
const fixtures = buildFixtures(TODAY);
const state = initialState(fixtures, TODAY);
const NEW_ID = "e6000000-0000-4000-8000-000000000001";

const card = {
  kind: "credit_card",
  label: "Mastercard",
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
};

it("values every fixture debt, the UVA one at the day's UVA", () => {
  const uva = fixtures.quotes.fxRates.filter((row) => row.kind === "uva");
  const valued = valueLiabilities(
    liabilitiesToday(fixtures.liabilities, new Map(), TODAY),
    {
      date: TODAY,
      fx: {
        uva: { sell: uva.at(-1)!.sell, date: TODAY },
        mep: { sell: "1200", date: TODAY },
      },
      prices: {},
    },
    { denominator: "ars", referenceDollar: "mep" },
  );
  expect(valued.complete).toBe(true);
});

it("creates, edits and deletes a debt", () => {
  const created = createLiability(state, card, NEW_ID);
  expect(created.result).toEqual({ ok: true, id: NEW_ID });
  const edited = updateLiability(created.state, NEW_ID, {
    ...card,
    balance: "2000",
  });
  expect(
    edited.state.liabilities.find((each) => each.id === NEW_ID)?.balance,
  ).toBe("2000");
  const deleted = deleteLiability(edited.state, NEW_ID);
  expect(deleted.state.liabilities).toHaveLength(state.liabilities.length);
});

it("refuses a debt in dollars counted in UVA", () => {
  expect(
    createLiability(state, { ...card, currency: "USD", uva: true }, NEW_ID)
      .result,
  ).toEqual({ ok: false, code: "invalid" });
});

describe("debt events", () => {
  const LOAN = "e5000000-0000-4000-8000-000000000005";
  const USD_CASH = "c2000000-0000-4000-8000-000000000002";
  const cashOf = (s: typeof state) =>
    s.holdings.find((each) => each.holding.id === USD_CASH)!;
  const record = (event: unknown, cash: unknown = null, s = state) =>
    writeLiabilityEvent(
      s,
      {
        debtId: LOAN,
        id: "e7000000-0000-4000-8000-000000000001",
        createdAt: `${TODAY}T20:00:00.000Z`,
      },
      event,
      cash,
    );
  const payment = {
    kind: "payment",
    date: TODAY,
    amount: "500",
    settles: false,
  };

  it("records a payment and takes it from the cash holding", () => {
    const { state: after, result } = record(payment, {
      holding_id: USD_CASH,
      take: true,
      expected: "2500",
    });
    expect(result).toEqual({
      ok: true,
      id: "e7000000-0000-4000-8000-000000000001",
      cashRestored: true,
    });
    expect(after.liabilityEvents.get(LOAN)).toHaveLength(3);
    expect(cashOf(after).holding.amount).toBe("2000");
  });

  it("refuses what the event RPCs refuse", () => {
    expect(
      record(payment, { holding_id: USD_CASH, take: true, expected: "1" })
        .result,
    ).toEqual({ ok: false, code: "stale" });
    expect(
      record(
        { ...payment, amount: "9999" },
        {
          holding_id: USD_CASH,
          take: true,
          expected: "2500",
        },
      ).result,
    ).toEqual({ ok: false, code: "insufficient_cash" });
    expect(record({ ...payment, date: "2099-01-01" }).result).toEqual({
      ok: false,
      code: "future_date",
    });
    expect(record({ kind: "payment", date: TODAY }).result).toEqual({
      ok: false,
      code: "invalid",
    });
  });

  it("gives the cash back when the payment that took it is deleted", () => {
    const taken = record(payment, {
      holding_id: USD_CASH,
      take: true,
      expected: "2500",
    }).state;
    const { state: after, result } = deleteLiabilityEvent(
      taken,
      "e7000000-0000-4000-8000-000000000001",
    );
    expect(result).toMatchObject({ ok: true, cashRestored: true });
    expect(cashOf(after).holding.amount).toBe("2500");
    expect(after.liabilityEvents.get(LOAN)).toHaveLength(2);
  });

  it("edits an event in place, keeping its place in the day", () => {
    const [latest] = state.liabilityEvents.get(LOAN)!;
    const { state: after, result } = writeLiabilityEvent(
      state,
      { eventId: latest!.id },
      { kind: "payment", date: latest!.date, amount: "1200", settles: false },
      null,
    );
    expect(result).toMatchObject({ ok: true, id: latest!.id });
    const edited = after.liabilityEvents
      .get(LOAN)!
      .find((each) => each.id === latest!.id)!;
    expect(edited).toMatchObject({
      amount: "1200",
      created_at: latest!.created_at,
    });
  });

  it("keeps a debt closed until an adjustment reopens it", () => {
    const settled = record({ ...payment, settles: true }).state;
    expect(
      writeLiabilityEvent(
        settled,
        {
          debtId: LOAN,
          id: "e7000000-0000-4000-8000-000000000002",
          createdAt: `${TODAY}T21:00:00.000Z`,
        },
        { kind: "rate_change", date: TODAY, annual_rate: "0.2" },
        null,
      ).result,
    ).toEqual({
      ok: true,
      id: "e7000000-0000-4000-8000-000000000002",
      cashRestored: true,
    });
  });

  it("pledges the user's holdings and refuses one that does not exist", () => {
    expect(
      setCollateral(state, LOAN, [USD_CASH]).state.liabilityCollateral.get(
        LOAN,
      ),
    ).toEqual([USD_CASH]);
    expect(setCollateral(state, LOAN, ["nope"]).result).toEqual({
      ok: false,
      code: "not_found",
    });
  });
});
