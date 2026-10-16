import {
  addDays,
  buenosAiresDate,
  Constants,
  divideRounded,
  fromScaled,
  type LiabilityEventGuardHint,
  nonNegativeDecimalSchema,
  positiveDecimalSchema,
  toScaled,
  daysBetween,
} from "@plant/shared";
import { z } from "zod";

import { annualRate, holdingDateSchema } from "../valuation/holding";
import type { Liability, LiabilityKind, LiabilityOnDate } from "./liability";

// What happens to a debt after it opens: a rate change sets the rate from the
// day after its date, a payment lowers the balance by its amount in the debt's
// unit (and settles closes it), an adjustment sets the balance to the
// lender's figure. Card debts follow their statements and take none.
export const LIABILITY_EVENT_KINDS =
  Constants.public.Enums.liability_event_kind;
export type LiabilityEventKind = (typeof LIABILITY_EVENT_KINDS)[number];

const eventBase = {
  id: z.string(),
  liability_id: z.string(),
  date: holdingDateSchema,
  created_at: z.string(),
};

// Each kind by the columns it is stored under; the liability_events_fields
// CHECK holds the same shape.
export const liabilityEventSchema = z.discriminatedUnion("kind", [
  z
    .object({
      ...eventBase,
      kind: z.literal("rate_change"),
      amount: z.null(),
      annual_rate: annualRate,
      cash_holding_id: z.null(),
      takes_cash: z.literal(false),
      settles: z.literal(false),
    })
    .strict(),
  z
    .object({
      ...eventBase,
      kind: z.literal("payment"),
      amount: positiveDecimalSchema,
      annual_rate: z.null(),
      cash_holding_id: z.string().nullable(),
      takes_cash: z.boolean(),
      settles: z.boolean(),
    })
    .strict(),
  z
    .object({
      ...eventBase,
      kind: z.literal("adjustment"),
      amount: nonNegativeDecimalSchema,
      annual_rate: z.null(),
      cash_holding_id: z.null(),
      takes_cash: z.literal(false),
      settles: z.literal(false),
    })
    .strict(),
]);
export type LiabilityEvent = z.output<typeof liabilityEventSchema>;

// What a user fills for each kind of event.
const [rateChangeEvent, paymentEvent, adjustmentEvent] =
  liabilityEventSchema.options;
export const liabilityEventInputSchema = z.discriminatedUnion("kind", [
  rateChangeEvent.pick({ kind: true, date: true, annual_rate: true }).strict(),
  paymentEvent
    .pick({ kind: true, date: true, amount: true, settles: true })
    .strict(),
  adjustmentEvent.pick({ kind: true, date: true, amount: true }).strict(),
]);

export const takesEvents = (kind: LiabilityKind): boolean =>
  kind !== "credit_card";

export const defaultAccrues = (kind: LiabilityKind): boolean =>
  kind === "crypto_loan";

// Only a debt in a currency, and not in UVA, is paid from a cash holding.
export const takesCashLink = (
  debt: Pick<Liability, "currency" | "uva">,
): boolean => debt.currency !== null && !debt.uva;

// Whether a payment of `debt` can have come from `holding`: cash in the
// debt's currency, as move_cash requires.
export const paysFromCash = (
  debt: Pick<Liability, "currency" | "uva">,
  holding: { asset_class: string; currency: string | null },
): boolean =>
  takesCashLink(debt) &&
  holding.asset_class === "cash" &&
  holding.currency === debt.currency;

// The holding a payment took its cash from, up to `today`, or null.
export const cashTakenFrom = (
  event: LiabilityEvent,
  today: string,
): string | null =>
  event.kind === "payment" && event.takes_cash && event.date <= today
    ? event.cash_holding_id
    : null;

// How a debt's balance moved between two days, in its unit: the interest it
// accrued (`end`'s of the month, so `start` is the end of the month before,
// less the gap closing it left), and the rest after `paid`: new principal,
// a lender's correction or that gap, negative when it lowered the debt.
export function liabilityChange(
  start: Pick<LiabilityBalance, "balance">,
  end: Pick<
    LiabilityBalance,
    "balance" | "interestThisMonth" | "closingThisMonth"
  >,
  paid: string,
): { interest: string; principal: string } {
  const interest =
    toScaled(end.interestThisMonth) - toScaled(end.closingThisMonth);
  return {
    interest: fromScaled(interest),
    principal: fromScaled(
      toScaled(end.balance) -
        toScaled(start.balance) +
        toScaled(paid) -
        interest,
    ),
  };
}

// The fields a debt's form shows: a card never accrues, and a debt that
// accrues has no installment (the CHECKs accrualAgrees mirrors).
export function liabilityFieldsFor(debt: {
  kind: LiabilityKind;
  accrues: boolean;
}): { accrues: boolean; installments: boolean } {
  const accrues = takesEvents(debt.kind);
  return { accrues, installments: !(accrues && debt.accrues) };
}

// opened_on, or the Buenos Aires day the debt was created, as
// private.liability_guard keeps anchored_on.
export const anchorOf = (debt: {
  opened_on: string | null;
  created_at: string;
}): string => debt.opened_on ?? buenosAiresDate(new Date(debt.created_at));

// A day's events in the order they were entered, with a settling payment
// last, as the lender's figure for the day.
export function compareLiabilityEvents(
  a: Pick<LiabilityEvent, "date" | "settles" | "created_at" | "id">,
  b: Pick<LiabilityEvent, "date" | "settles" | "created_at" | "id">,
): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  if (a.settles !== b.settles) return a.settles ? 1 : -1;
  if (a.created_at !== b.created_at)
    return a.created_at < b.created_at ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export type LiabilityEventInput = {
  id?: string;
  kind: LiabilityEventKind;
  date: string;
  amount: string | null;
  settles: boolean;
  cash_holding_id: string | null;
};

type HistoryEntry = Pick<
  LiabilityEvent,
  "id" | "kind" | "date" | "amount" | "settles" | "created_at"
>;

const isAdjustmentTo = (event: HistoryEntry, zero: boolean): boolean =>
  event.kind === "adjustment" &&
  event.amount !== null &&
  (toScaled(event.amount) === 0n) === zero;

// The rule private.liability_history_guard checks after every write: a debt
// closes with a settling payment or an adjustment to 0, and no payment or rate
// change applies after a close (nor a second settle shares its day) without
// an adjustment above 0 applied in between, in compareLiabilityEvents' order.
function reopensBeforeEachEvent(events: readonly HistoryEntry[]): boolean {
  return !events.some(
    (close) =>
      (close.settles || isAdjustmentTo(close, true)) &&
      events.some(
        (other) =>
          other.kind !== "adjustment" &&
          other.id !== close.id &&
          (compareLiabilityEvents(other, close) > 0 ||
            (other.settles && close.settles && other.date === close.date)) &&
          !events.some(
            (reopen) =>
              isAdjustmentTo(reopen, false) &&
              compareLiabilityEvents(reopen, close) > 0 &&
              compareLiabilityEvents(reopen, other) < 0,
          ),
      ),
  );
}

// Whether a debt takes an event, new or edited, by the rules
// private.liability_event_guard and private.liability_history_guard enforce:
// a card takes none, an event is dated today or earlier and on or after the
// anchor, a cash holding is named only where takesCashLink allows, and the
// history it leaves keeps every close.
export function admitLiabilityEvent(
  debt: Pick<Liability, "kind" | "currency" | "uva" | "anchored_on">,
  events: readonly LiabilityEvent[],
  event: LiabilityEventInput,
  today: string,
): LiabilityEventGuardHint | null {
  if (!takesEvents(debt.kind)) return "no_history";
  if (event.date > today) return "future_date";
  if (event.date < debt.anchored_on) return "before_opening";
  if (event.cash_holding_id !== null && !takesCashLink(debt))
    return "no_cash_link";
  const id = event.id ?? "";
  // A new event is entered after every other.
  const created_at =
    events.find((other) => other.id === id)?.created_at ?? "\uffff";
  const after = [
    ...events.filter((other) => other.id !== id),
    { ...event, id, created_at },
  ];
  return reopensBeforeEachEvent(after) ? null : "settled";
}

// Whether a debt's event can be deleted: the history it leaves keeps every
// close, as private.liability_history_guard checks.
export function admitLiabilityEventDeletion(
  events: readonly LiabilityEvent[],
  id: string,
): LiabilityEventGuardHint | null {
  return reopensBeforeEachEvent(events.filter((event) => event.id !== id))
    ? null
    : "settled";
}

// Whether a debt with these events takes an edit of its row, by the rules
// private.liability_guard enforces: a debt opens today or earlier; once it
// has events its kind and unit stay, and it opens on or before its first
// event. `anchorWhenCleared` is the day the anchor falls back to when the edit
// clears the opening date (the day the debt was created).
export function admitLiabilityUpdate(
  debt: Pick<Liability, "kind" | "currency" | "uva" | "instrument_symbol">,
  next: Pick<
    Liability,
    "kind" | "currency" | "uva" | "instrument_symbol" | "opened_on"
  >,
  events: readonly Pick<LiabilityEvent, "date">[],
  anchorWhenCleared: string,
  today: string,
): LiabilityEventGuardHint | null {
  if (next.opened_on !== null && next.opened_on > today) return "future_date";
  if (events.length === 0) return null;
  if (
    next.kind !== debt.kind ||
    next.currency !== debt.currency ||
    next.uva !== debt.uva ||
    next.instrument_symbol !== debt.instrument_symbol
  ) {
    return "has_history";
  }
  const first = events.reduce(
    (earliest, event) => (event.date < earliest ? event.date : earliest),
    events[0]!.date,
  );
  return (next.opened_on ?? anchorWhenCleared) > first
    ? "before_opening"
    : null;
}

// A cash holding's amount after a payment takes `delta` from it: archived at
// 0, refused below it, as public.move_cash does.
export function cashAfter(
  amount: string,
  delta: string,
): { amount: string; archived: boolean } | "insufficient_cash" {
  const after = toScaled(amount) + toScaled(delta);
  if (after < 0n) return "insufficient_cash";
  return after === 0n
    ? { amount, archived: true }
    : { amount: fromScaled(after), archived: false };
}

// Accrual runs on fixed-point integers at FACTOR_SCALE, past the 8 decimals a
// balance keeps, so a balance rounds once per segment; a balance is stored
// only at an event, so today's figure is the same whichever days were asked
// for.
const FACTOR_SCALE = 10n ** 20n;
const DAYS_IN_YEAR = 365n;
// A balance from 10^12 on does not fit numeric(20, 8): accrual stops there.
const BALANCE_LIMIT = 10n ** 12n * 10n ** 8n;

// (1 + rate / 365)^days at FACTOR_SCALE, by squaring; null once it would
// carry `balance` past BALANCE_LIMIT.
function accrualFactor(
  rate: bigint,
  days: number,
  balance: bigint,
): bigint | null {
  const limit =
    balance === 0n ? null : (BALANCE_LIMIT * FACTOR_SCALE) / balance;
  let base = FACTOR_SCALE + divideRounded(rate * 10n ** 12n, DAYS_IN_YEAR);
  let factor = FACTOR_SCALE;
  for (let n = days; n > 0; n = Math.floor(n / 2)) {
    if (n % 2 === 1) factor = divideRounded(factor * base, FACTOR_SCALE);
    if (limit !== null && factor > limit) return null;
    if (n > 1) base = divideRounded(base * base, FACTOR_SCALE);
  }
  return factor;
}

const accrued = (balance: bigint, factor: bigint): bigint =>
  divideRounded(balance * factor, FACTOR_SCALE);

export type LiabilityBalance = {
  // What is owed today, in the debt's unit.
  balance: string;
  // The last yearly rate set, in force from the day after its date.
  rate: string | null;
  // One day's interest on today's balance at today's rate; 0 unless it accrues.
  dailyInterest: string;
  // What accrued since the month started, plus the gaps the lender's figures
  // and a settle explained as interest; 0 unless it accrues.
  interestThisMonth: string;
  // The part of interestThisMonth a settle or the lender's 0 closed the
  // debt with, beyond or short of its balance, rather than accrued.
  closingThisMonth: string;
  open: boolean;
  // Today's balance is a projection: it accrues and no figure of the lender's
  // or settle closes it today.
  estimated: boolean;
  // A payment beyond what a debt that does not accrue owed.
  overpaid: boolean;
  // Accrual stopped where the balance would no longer fit numeric(20, 8).
  overflow: boolean;
};

// A debt's figures on a day from its row (the balance and rate on its anchor
// day) and its events; on a day before the anchor, the row's balance.
export function liabilityBalance(
  debt: Pick<Liability, "balance" | "annual_rate" | "accrues" | "anchored_on">,
  events: readonly LiabilityEvent[],
  today: string,
): LiabilityBalance {
  const monthEnd = addDays(`${today.slice(0, 7)}-01`, -1);
  let balance = toScaled(debt.balance);
  let rate = debt.annual_rate === null ? 0n : toScaled(debt.annual_rate);
  let rateText = debt.annual_rate;
  let at = debt.anchored_on;
  let open = true;
  let interest = 0n;
  let overpaid = false;
  let overflow = false;

  // The balance on `to`, accrued from `at`, and the part of the accrual dated in this
  // month, without storing it.
  const accrue = (to: string): { value: bigint; inMonth: bigint } => {
    if (!debt.accrues || !open || to <= at || rate === 0n || overflow)
      return { value: balance, inMonth: 0n };
    const factor = accrualFactor(rate, daysBetween(at, to), balance);
    if (factor === null) {
      overflow = true;
      return { value: balance, inMonth: 0n };
    }
    const value = accrued(balance, factor);
    if (to <= monthEnd) return { value, inMonth: 0n };
    if (at >= monthEnd) return { value, inMonth: value - balance };
    const atMonthEnd = accrualFactor(rate, daysBetween(at, monthEnd), balance);
    return {
      value,
      inMonth: atMonthEnd === null ? 0n : value - accrued(balance, atMonthEnd),
    };
  };
  // What closing the debt forgave or settled within the month, part of
  // `interest` but not interest a period result counts.
  let closing = 0n;
  const gap = (date: string, amount: bigint, closes = false) => {
    if (!debt.accrues || date <= monthEnd) return;
    interest += amount;
    if (closes) closing += amount;
  };

  const sorted = [...events]
    .filter((event) => event.date <= today)
    .sort(compareLiabilityEvents);
  let last: LiabilityEvent | undefined;
  for (const event of sorted) {
    const { value, inMonth } = accrue(event.date);
    balance = value;
    interest += inMonth;
    at = event.date;
    last = event;
    if (event.kind === "rate_change") {
      rate = toScaled(event.annual_rate);
      rateText = event.annual_rate;
    } else if (event.kind === "adjustment") {
      const figure = toScaled(event.amount);
      // Reopening a closed debt is new principal, not interest.
      if (open) gap(event.date, figure - balance, figure === 0n);
      balance = figure;
      open = figure > 0n;
    } else {
      balance -= toScaled(event.amount);
      if (balance < 0n) {
        // Paid beyond the balance: for a debt that accrues, the difference
        // was interest; otherwise an overpayment.
        if (debt.accrues) gap(event.date, -balance, event.settles);
        else overpaid = true;
        balance = 0n;
      }
      if (event.settles) {
        gap(event.date, -balance, true);
        balance = 0n;
      }
      open = balance > 0n;
    }
  }
  const { value, inMonth } = accrue(today);
  interest += inMonth;
  const dailyInterest =
    debt.accrues && open
      ? divideRounded(value * rate, DAYS_IN_YEAR * 10n ** 8n)
      : 0n;
  const closedToday =
    last !== undefined &&
    ((last.kind === "adjustment" && last.date === today) || last.settles);
  return {
    balance: fromScaled(value),
    rate: rateText,
    dailyInterest: fromScaled(dailyInterest),
    interestThisMonth: fromScaled(debt.accrues ? interest : 0n),
    closingThisMonth: fromScaled(closing),
    open,
    estimated: debt.accrues && open && !closedToday,
    overpaid,
    overflow,
  };
}

// Each debt with the balance and rate computed for the day, closed ones at 0:
// the form valueLiabilities takes.
export function liabilitiesOn(
  debts: readonly Liability[],
  figures: ReadonlyMap<string, LiabilityBalance>,
): LiabilityOnDate[] {
  return debts.map((debt) => {
    const figure = figures.get(debt.id);
    if (figure === undefined) throw new Error(`no figure for debt ${debt.id}`);
    return {
      ...debt,
      balance: figure.balance,
      annual_rate: figure.rate,
    } as LiabilityOnDate;
  });
}

// Each debt's figures on a day, from every event read.
export function liabilityBalances(
  debts: readonly Liability[],
  events: ReadonlyMap<string, readonly LiabilityEvent[]>,
  today: string,
): Map<string, LiabilityBalance> {
  return new Map(
    debts.map((debt) => [
      debt.id,
      liabilityBalance(debt, events.get(debt.id) ?? [], today),
    ]),
  );
}

// Whether a debt still owes something: a paid-off one stays listed at 0.
export const isOwed = (debt: Pick<LiabilityOnDate, "balance">): boolean =>
  toScaled(debt.balance) > 0n;

// Every debt valued as it stands today.
export const liabilitiesToday = (
  debts: readonly Liability[],
  events: ReadonlyMap<string, readonly LiabilityEvent[]>,
  today: string,
): LiabilityOnDate[] =>
  liabilitiesOn(debts, liabilityBalances(debts, events, today));

// What is owed over what is pledged for it, as a fraction; null with nothing
// pledged.
export function loanToValue(owed: string, pledged: string): string | null {
  const value = toScaled(pledged);
  if (value <= 0n) return null;
  return fromScaled(divideRounded(toScaled(owed) * 10n ** 8n, value));
}
