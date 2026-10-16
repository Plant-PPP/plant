import { fromScaled, toScaled } from "@plant/shared";
import { lastFunctionBodies } from "@plant/shared/testing";

import {
  admitLiabilityEvent,
  admitLiabilityEventDeletion,
  admitLiabilityUpdate,
  anchorOf,
  cashAfter,
  isOwed,
  type LiabilityEvent,
  liabilityBalance,
  liabilitiesOn,
  liabilityChange,
  liabilityFieldsFor,
  loanToValue,
  paysFromCash,
} from "./history";
import type { Liability } from "./liability";

const loan = (fields: Partial<Liability> = {}): Liability => ({
  id: "d1",
  kind: "usd_debt",
  label: "Préstamo",
  lender: null,
  currency: "USD",
  uva: false,
  instrument_symbol: null,
  balance: "50000",
  installment: null,
  annual_rate: "0.12",
  installments_left: null,
  next_due_on: null,
  matures_on: null,
  accrues: true,
  opened_on: "2026-01-01",
  anchored_on: "2026-01-01",
  ...fields,
});

let seq = 0;
const event = (
  fields: Partial<LiabilityEvent> & Pick<LiabilityEvent, "kind" | "date">,
): LiabilityEvent => {
  seq += 1;
  const base = {
    id: `e${seq}`,
    liability_id: "d1",
    created_at: new Date(Date.UTC(2026, 0, 1) + seq * 1000).toISOString(),
    amount: null,
    annual_rate: null,
    cash_holding_id: null,
    takes_cash: false,
    settles: false,
  };
  return { ...base, ...fields } as LiabilityEvent;
};

// (1 + 0.12/365)^n in floating point, the reference the exact figures match.
const reference = (principal: number, days: number) =>
  principal * (1 + 0.12 / 365) ** days;

describe("liabilityBalance", () => {
  it.each([1, 30, 365])("compounds a loan daily over %i days", (days) => {
    const today = new Date(Date.UTC(2026, 0, 1 + days))
      .toISOString()
      .slice(0, 10);
    const { balance } = liabilityBalance(loan(), [], today);
    expect(Math.abs(Number(balance) - reference(50000, days))).toBeLessThan(
      1e-6,
    );
  });

  it("gives the same balance whichever day it is asked from an event", () => {
    const events = [
      event({ kind: "payment", date: "2026-02-15", amount: "1000" }),
    ];
    const direct = liabilityBalance(loan(), events, "2026-06-30");
    const pastIt = liabilityBalance(
      loan(),
      [
        ...events,
        event({ kind: "rate_change", date: "2026-03-31", annual_rate: "0.12" }),
      ],
      "2026-06-30",
    );
    expect(pastIt.balance).toBe(direct.balance);
  });

  it("applies a rate change from the day after its date", () => {
    const changed = liabilityBalance(
      loan(),
      [event({ kind: "rate_change", date: "2026-01-02", annual_rate: "0" })],
      "2026-01-10",
    );
    expect(Number(changed.balance)).toBeCloseTo(reference(50000, 1), 6);
    expect(changed.rate).toBe("0");
    expect(changed.dailyInterest).toBe("0");
  });

  it("lowers the balance by a payment and resets it to the lender's figure", () => {
    const paid = liabilityBalance(
      loan({ accrues: false, annual_rate: null }),
      [
        event({ kind: "payment", date: "2026-02-01", amount: "1000" }),
        event({ kind: "adjustment", date: "2026-03-01", amount: "48000" }),
        event({ kind: "payment", date: "2026-03-02", amount: "500" }),
      ],
      "2026-04-01",
    );
    expect(paid.balance).toBe("47500");
    expect(paid.estimated).toBe(false);
    expect(paid.interestThisMonth).toBe("0");
  });

  it("applies a day's events in the order they were entered", () => {
    const debt = loan({ accrues: false, annual_rate: null });
    const payment = event({
      kind: "payment",
      date: "2026-02-01",
      amount: "1000",
    });
    const figure = event({
      kind: "adjustment",
      date: "2026-02-01",
      amount: "30000",
    });
    expect(
      liabilityBalance(debt, [figure, payment], "2026-03-01").balance,
    ).toBe("30000");
    const later = { ...payment, created_at: "2026-01-01T00:01:00Z" };
    expect(liabilityBalance(debt, [figure, later], "2026-03-01").balance).toBe(
      "29000",
    );
  });

  it("applies a day's settle last", () => {
    const sameDay = liabilityBalance(
      loan({ accrues: false, annual_rate: null }),
      [
        event({ kind: "adjustment", date: "2026-02-01", amount: "30000" }),
        event({
          kind: "payment",
          date: "2026-02-01",
          amount: "30000",
          settles: true,
        }),
      ],
      "2026-03-01",
    );
    expect(sameDay).toMatchObject({ balance: "0", open: false });
  });

  it("counts the figure that reopens a closed debt as principal", () => {
    const reopened = liabilityBalance(
      loan({ annual_rate: "0" }),
      [
        event({ kind: "adjustment", date: "2026-10-02", amount: "0" }),
        event({ kind: "adjustment", date: "2026-10-05", amount: "1000" }),
      ],
      "2026-10-15",
    );
    expect(reopened).toMatchObject({
      balance: "1000",
      interestThisMonth: "-50000",
    });
  });

  it("accrues again from the figure that reopens it", () => {
    const reopened = liabilityBalance(
      loan(),
      [
        event({ kind: "adjustment", date: "2026-02-01", amount: "0" }),
        event({ kind: "adjustment", date: "2026-03-01", amount: "1000" }),
      ],
      "2026-03-31",
    );
    expect(reopened).toMatchObject({ open: true, estimated: true });
    expect(Number(reopened.balance)).toBeCloseTo(reference(1000, 30), 6);
  });

  it("counts a settle's gap and a figure's gap as interest this month", () => {
    const settled = liabilityBalance(
      loan(),
      [
        event({
          kind: "payment",
          date: "2026-03-10",
          amount: "60000",
          settles: true,
        }),
      ],
      "2026-03-20",
    );
    expect(settled.open).toBe(false);
    expect(settled.balance).toBe("0");
    const accrued = reference(50000, 68);
    // Accrued since the month started plus the gap the payoff closed.
    expect(Number(settled.interestThisMonth)).toBeCloseTo(
      accrued - reference(50000, 58) + (60000 - accrued),
      4,
    );
  });

  it("books a payment beyond the balance of a debt that does not accrue as overpaid", () => {
    const over = liabilityBalance(
      loan({ accrues: false, annual_rate: null }),
      [event({ kind: "payment", date: "2026-02-01", amount: "60000" })],
      "2026-03-01",
    );
    expect(over).toMatchObject({
      balance: "0",
      overpaid: true,
      interestThisMonth: "0",
    });
  });

  it("is estimated while it accrues, until the lender's figure of today", () => {
    expect(liabilityBalance(loan(), [], "2026-02-01").estimated).toBe(true);
    expect(
      liabilityBalance(
        loan(),
        [event({ kind: "adjustment", date: "2026-02-01", amount: "50500" })],
        "2026-02-01",
      ),
    ).toMatchObject({ balance: "50500", estimated: false });
  });

  it("stops accruing where the balance no longer fits", () => {
    const started = performance.now();
    const huge = liabilityBalance(
      loan({
        annual_rate: "10",
        opened_on: "1900-01-01",
        anchored_on: "1900-01-01",
      }),
      [],
      "2026-10-15",
    );
    expect(huge.overflow).toBe(true);
    expect(performance.now() - started).toBeLessThan(50);
  });
});

describe("admitLiabilityEvent", () => {
  const payment = {
    kind: "payment" as const,
    amount: "1",
    settles: false,
    cash_holding_id: null,
  };

  it("refuses what private.liability_event_guard refuses", () => {
    const today = "2026-10-15";
    expect(
      admitLiabilityEvent(
        loan({ kind: "credit_card" }),
        [],
        { ...payment, date: today },
        today,
      ),
    ).toBe("no_history");
    expect(
      admitLiabilityEvent(
        loan(),
        [],
        { ...payment, date: "2026-10-16" },
        today,
      ),
    ).toBe("future_date");
    expect(
      admitLiabilityEvent(
        loan(),
        [],
        { ...payment, date: "2025-12-31" },
        today,
      ),
    ).toBe("before_opening");
    expect(
      admitLiabilityEvent(
        loan({ uva: true, currency: "ARS", kind: "mortgage" }),
        [],
        { ...payment, date: today, cash_holding_id: "h1" },
        today,
      ),
    ).toBe("no_cash_link");
  });

  it("closes a settled debt until an adjustment reopens it", () => {
    const settle = event({
      kind: "payment",
      date: "2026-03-01",
      amount: "1",
      settles: true,
    });
    expect(
      admitLiabilityEvent(
        loan(),
        [settle],
        { ...payment, date: "2026-03-02" },
        "2026-10-15",
      ),
    ).toBe("settled");
    expect(
      admitLiabilityEvent(
        loan(),
        [
          settle,
          event({ kind: "adjustment", date: "2026-03-05", amount: "10" }),
        ],
        { ...payment, date: "2026-03-06" },
        "2026-10-15",
      ),
    ).toBeNull();
  });

  it("closes a debt with an adjustment to 0, and reopens it only above 0", () => {
    const zero = event({ kind: "adjustment", date: "2026-03-01", amount: "0" });
    expect(
      admitLiabilityEvent(
        loan(),
        [zero],
        { ...payment, date: "2026-03-02" },
        "2026-10-15",
      ),
    ).toBe("settled");
    expect(
      admitLiabilityEvent(
        loan(),
        [zero, event({ kind: "adjustment", date: "2026-03-02", amount: "0" })],
        { ...payment, date: "2026-03-03" },
        "2026-10-15",
      ),
    ).toBe("settled");
  });

  it("keeps the adjustment that reopened a debt under a later payment", () => {
    const settle = event({
      kind: "payment",
      date: "2026-03-01",
      amount: "1",
      settles: true,
    });
    const reopen = event({
      kind: "adjustment",
      date: "2026-03-05",
      amount: "10",
    });
    const later = event({ kind: "payment", date: "2026-03-06", amount: "1" });
    const history = [settle, reopen, later];
    expect(admitLiabilityEventDeletion(history, reopen.id)).toBe("settled");
    expect(
      admitLiabilityEvent(
        loan(),
        history,
        { ...reopen, cash_holding_id: null, date: "2026-03-10" },
        "2026-10-15",
      ),
    ).toBe("settled");
    expect(admitLiabilityEventDeletion(history, later.id)).toBeNull();
  });

  it("refuses a second settle on a close's day and a rate change after it", () => {
    const settle = event({
      kind: "payment",
      date: "2026-03-01",
      amount: "1",
      settles: true,
    });
    const today = "2026-10-15";
    expect(
      admitLiabilityEvent(
        loan(),
        [settle],
        { ...payment, date: "2026-03-01", settles: true },
        today,
      ),
    ).toBe("settled");
    expect(
      admitLiabilityEvent(
        loan(),
        [settle],
        { ...payment, date: "2026-03-01" },
        today,
      ),
    ).toBeNull();
    expect(
      admitLiabilityEvent(
        loan(),
        [settle],
        {
          kind: "rate_change",
          date: "2026-03-02",
          amount: null,
          settles: false,
          cash_holding_id: null,
        },
        today,
      ),
    ).toBe("settled");
  });

  it("reopens on a close's day only after an adjustment to 0", () => {
    const today = "2026-10-15";
    const settle = event({
      kind: "payment",
      date: "2026-03-01",
      amount: "1",
      settles: true,
    });
    const sameDay = event({
      kind: "adjustment",
      date: "2026-03-01",
      amount: "10",
    });
    expect(
      admitLiabilityEvent(
        loan(),
        [settle, sameDay],
        { ...payment, date: "2026-03-02" },
        today,
      ),
    ).toBe("settled");
    const zero = event({ kind: "adjustment", date: "2026-03-01", amount: "0" });
    const real = event({
      kind: "adjustment",
      date: "2026-03-01",
      amount: "500",
    });
    expect(
      admitLiabilityEvent(
        loan(),
        [zero, real],
        { ...payment, date: "2026-03-02" },
        today,
      ),
    ).toBeNull();
    expect(
      admitLiabilityEvent(
        loan(),
        [real, { ...zero, created_at: "2026-01-02T00:00:00Z" }],
        { ...payment, date: "2026-03-02" },
        today,
      ),
    ).toBe("settled");
  });

  it("refuses the lender's 0 on the day of a settle", () => {
    const settle = event({
      kind: "payment",
      date: "2026-03-01",
      amount: "1",
      settles: true,
    });
    expect(
      admitLiabilityEvent(
        loan(),
        [settle],
        {
          kind: "adjustment",
          date: "2026-03-01",
          amount: "0",
          settles: false,
          cash_holding_id: null,
        },
        "2026-10-15",
      ),
    ).toBe("settled");
  });

  it("refuses a payment applied after an adjustment to 0 on its day", () => {
    const zero = event({ kind: "adjustment", date: "2026-03-01", amount: "0" });
    expect(
      admitLiabilityEvent(
        loan(),
        [zero],
        { ...payment, date: "2026-03-01" },
        "2026-10-15",
      ),
    ).toBe("settled");
    const paid = event({ kind: "payment", date: "2026-03-02", amount: "1" });
    const closed = event({
      kind: "adjustment",
      date: "2026-03-02",
      amount: "0",
    });
    expect(admitLiabilityEventDeletion([paid, closed], "none")).toBeNull();
  });

  it("counts a new event as entered last, and an edit in its place", () => {
    const today = "2026-10-15";
    const real = event({
      kind: "adjustment",
      date: "2026-03-01",
      amount: "500",
    });
    const later = event({ kind: "payment", date: "2026-03-02", amount: "1" });
    expect(
      admitLiabilityEvent(
        loan(),
        [real, later],
        {
          kind: "adjustment",
          date: "2026-03-01",
          amount: "0",
          settles: false,
          cash_holding_id: null,
        },
        today,
      ),
    ).toBe("settled");
    const zero = event({ kind: "adjustment", date: "2026-03-01", amount: "0" });
    const fixed = event({
      kind: "adjustment",
      date: "2026-03-01",
      amount: "500",
    });
    expect(
      admitLiabilityEvent(
        loan(),
        [zero, fixed, later],
        { ...zero, cash_holding_id: null },
        today,
      ),
    ).toBeNull();
  });

  it("names the hints the guards raise", () => {
    const guards = [
      ...lastFunctionBodies(/liability_(event|history)_guard/).values(),
    ].join("\n");
    for (const hint of [
      "no_history",
      "future_date",
      "before_opening",
      "no_cash_link",
      "settled",
    ]) {
      expect(guards).toContain(`HINT = '${hint}'`);
    }
  });
});

describe("helpers", () => {
  it("values only debts it has a figure for", () => {
    expect(() => liabilitiesOn([loan()], new Map())).toThrow(
      "no figure for debt d1",
    );
  });

  it("owes while the balance is above 0", () => {
    expect(isOwed({ balance: "0" })).toBe(false);
    expect(isOwed({ balance: "0.00000001" })).toBe(true);
  });

  it("shows the installment fields unless a debt that takes events accrues", () => {
    expect(liabilityFieldsFor({ kind: "usd_debt", accrues: true })).toEqual({
      accrues: true,
      installments: false,
    });
    expect(liabilityFieldsFor({ kind: "credit_card", accrues: true })).toEqual({
      accrues: false,
      installments: true,
    });
  });

  it("anchors a debt on the Buenos Aires day it was created", () => {
    expect(
      anchorOf({ opened_on: null, created_at: "2026-10-15T02:00:00Z" }),
    ).toBe("2026-10-14");
    expect(
      anchorOf({ opened_on: "2026-01-01", created_at: "2026-10-15T02:00:00Z" }),
    ).toBe("2026-01-01");
  });

  it("anchors in the time zone the guard uses", () => {
    const [guard] = lastFunctionBodies(/liability_guard/).values();
    expect(guard).toContain("AT TIME ZONE 'America/Argentina/Buenos_Aires'");
  });

  it("archives a cash holding a payment empties", () => {
    expect(cashAfter("100", "-100")).toEqual({ amount: "100", archived: true });
    expect(cashAfter("100", "-30")).toEqual({ amount: "70", archived: false });
    expect(cashAfter("100", "-130")).toBe("insufficient_cash");
  });

  it("values a closed debt at 0 and divides what is owed by what is pledged", () => {
    const [closed] = liabilitiesOn(
      [loan()],
      new Map([
        [
          "d1",
          liabilityBalance(
            loan(),
            [event({ kind: "adjustment", date: "2026-02-01", amount: "0" })],
            "2026-03-01",
          ),
        ],
      ]),
    );
    expect(closed!.balance).toBe("0");
    expect(loanToValue("50", "100")).toBe("0.5");
    expect(loanToValue("50", "0")).toBeNull();
  });
});

describe("admitLiabilityUpdate", () => {
  const today = "2026-10-15";
  const events = [event({ kind: "payment", date: "2026-02-01", amount: "1" })];
  const debt = loan();

  it("refuses what private.liability_guard refuses", () => {
    expect(
      admitLiabilityUpdate(
        debt,
        { ...debt, opened_on: "2026-10-16" },
        [],
        debt.anchored_on,
        today,
      ),
    ).toBe("future_date");
    expect(
      admitLiabilityUpdate(
        debt,
        { ...debt, kind: "personal_loan" },
        events,
        debt.anchored_on,
        today,
      ),
    ).toBe("has_history");
    expect(
      admitLiabilityUpdate(
        debt,
        { ...debt, opened_on: "2026-03-01" },
        events,
        debt.anchored_on,
        today,
      ),
    ).toBe("before_opening");
    expect(
      admitLiabilityUpdate(
        debt,
        { ...debt, opened_on: null },
        events,
        "2026-05-01",
        today,
      ),
    ).toBe("before_opening");
  });

  it("takes any edit of a debt with no events, and a label on one with", () => {
    expect(
      admitLiabilityUpdate(
        debt,
        { ...debt, kind: "personal_loan", currency: "ARS" },
        [],
        debt.anchored_on,
        today,
      ),
    ).toBeNull();
    expect(
      admitLiabilityUpdate(
        debt,
        { ...debt, opened_on: "2026-01-15" },
        events,
        debt.anchored_on,
        today,
      ),
    ).toBeNull();
  });
});

describe("liabilityChange", () => {
  it("splits a month's change into its interest and the rest", () => {
    const debt = loan();
    const events = [
      event({ kind: "payment", date: "2026-03-10", amount: "1000" }),
      event({ kind: "adjustment", date: "2026-03-20", amount: "60000" }),
    ];
    const start = liabilityBalance(debt, events, "2026-02-28");
    const end = liabilityBalance(debt, events, "2026-03-31");
    const { interest, principal } = liabilityChange(start, end, "1000");
    expect(interest).toBe(end.interestThisMonth);
    // A debt that accrues explains a lender's figure as interest.
    expect(principal).toBe("0");
    const card = loan({ accrues: false, annual_rate: null });
    const owed = liabilityChange(
      liabilityBalance(card, events, "2026-02-28"),
      liabilityBalance(card, events, "2026-03-31"),
      "1000",
    );
    expect(owed).toEqual({ interest: "0", principal: "11000" });
  });
});

describe("liabilityChange of a closed debt", () => {
  it("counts what closing forgave as principal, not interest", () => {
    const debt = loan();
    const events = [
      event({ kind: "adjustment", date: "2026-03-15", amount: "0" }),
    ];
    const start = liabilityBalance(debt, events, "2026-02-28");
    const end = liabilityBalance(debt, events, "2026-03-31");
    const accrued = liabilityBalance(debt, [], "2026-03-15");
    const { interest, principal } = liabilityChange(start, end, "0");
    expect(interest).toBe(accrued.interestThisMonth);
    expect(principal).toBe(
      fromScaled(-toScaled(start.balance) - toScaled(interest)),
    );
  });
});

describe("paysFromCash", () => {
  it("takes cash in the debt's own currency only", () => {
    const cash = { asset_class: "cash", currency: "USD" };
    expect(paysFromCash(loan(), cash)).toBe(true);
    expect(paysFromCash(loan(), { ...cash, currency: "ARS" })).toBe(false);
    expect(paysFromCash(loan(), { ...cash, asset_class: "instrument" })).toBe(
      false,
    );
    expect(paysFromCash(loan({ uva: true, currency: "ARS" }), cash)).toBe(
      false,
    );
    expect(paysFromCash(loan({ currency: null }), cash)).toBe(false);
    expect(
      paysFromCash(loan({ currency: "EUR" }), { ...cash, currency: "EUR" }),
    ).toBe(true);
  });
});
