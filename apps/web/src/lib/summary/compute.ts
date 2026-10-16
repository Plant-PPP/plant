import {
  type Benchmarks,
  benchmarksBetween,
  chainedChange,
} from "./benchmarks";
import {
  type CashFlow,
  cashFlowsOf,
  cashTakenFrom,
  chainedShare,
  compareMovements,
  type Denominator,
  feedDatesOn,
  type FeedDays,
  feedDaysOf,
  holdingSchema,
  isYield,
  type Liability,
  type LiabilityEvent,
  type LiabilityOnDate,
  type LiabilityBalance,
  liabilitiesOn,
  liabilityBalances,
  liabilityChange,
  liabilityQuotesNeeded,
  type Movement,
  paysFromCash,
  type QuoteNeed,
  type QuoteSnapshot,
  periodResult,
  QUOTE_CARRY_DAYS,
  quotesNeeded,
  type StoredQuotes,
  snapshotOn,
  takesUnits,
  VALUED_FX_KINDS,
  valueHoldings,
  valueLiabilities,
} from "@plant/core";
import {
  addDays,
  compareExact,
  currencySchema,
  type Exact,
  exactOf,
  minus,
  negated,
  over,
  plus,
  stored,
  sumOrNull,
  times,
  ZERO,
} from "@plant/shared";

import { holdingName, instrumentNames } from "@/lib/holdings/holding-name";
import type { HoldingRow } from "@/lib/holdings/read";
import {
  allRows,
  closedIds,
  difference,
  type Ledger,
  lineOf,
  moneyChange,
  operationOf,
  positionBefore,
  pricedSnapshotOf,
  stepsOf,
} from "@/lib/ledger/ledger";
import {
  type Month,
  type MonthClose,
  type MonthDetail,
  monthsBetween,
  type YearClose,
} from "@/lib/summary/closes";

// What closes are computed from: the ledger, with stored quotes covering
// every day closeDates names, the debts and their events, the closed months
// a write changed, by period, with the day it did, and whether a read the
// past closes depend on was cut (the ledger, debts, their events or
// holdings).
export type ClosesState = Ledger & {
  liabilities: readonly Liability[];
  liabilityEvents: ReadonlyMap<string, readonly LiabilityEvent[]>;
  recalculated: ReadonlyMap<string, string>;
  partial: boolean;
};

type DebtPayment = { date: string; amount: Exact; fromCash: boolean };

// The debts' payments as the closes use them, built once per state: each
// debt's payments up to today by period, each one from cash when it took its
// amount from an open or closed cash holding in the debt's currency, which
// then held it until that day; and, per such holding, its payments by date
// with what the ones from each on add up to. Any other payment, a link that
// only names an account included, was money from outside.
type DebtPayments = {
  byDebt: Map<string, Map<string, DebtPayment[]>>;
  taken: Map<string, { dates: { date: string }[]; from: Exact[] }>;
  closed: Set<string>;
  // Payments that took cash from a holding the closes cannot give it back
  // to.
  skipped: number;
};

const paymentsCache = new WeakMap<ClosesState, DebtPayments>();

function debtPaymentsOf(state: ClosesState): DebtPayments {
  const kept = paymentsCache.get(state);
  if (kept) return kept;
  const holdings = new Map(allRows(state).map((row) => [row.id, row.holding]));
  const byDebt = new Map<string, Map<string, DebtPayment[]>>();
  const byHolding = new Map<string, { date: string; amount: Exact }[]>();
  let skipped = 0;
  for (const debt of state.liabilities) {
    const periods = new Map<string, DebtPayment[]>();
    for (const event of state.liabilityEvents.get(debt.id) ?? []) {
      if (event.kind !== "payment" || event.date > state.today) continue;
      const id = cashTakenFrom(event, state.today);
      const holding = id === null ? undefined : holdings.get(id);
      const fromCash = holding !== undefined && paysFromCash(debt, holding);
      if (event.takes_cash && !fromCash) skipped += 1;
      const amount = exactOf(event.amount);
      const period = event.date.slice(0, 7);
      const own = periods.get(period) ?? [];
      own.push({ date: event.date, amount, fromCash });
      periods.set(period, own);
      if (fromCash) {
        const taken = byHolding.get(id!) ?? [];
        taken.push({ date: event.date, amount });
        byHolding.set(id!, taken);
      }
    }
    byDebt.set(debt.id, periods);
  }
  const taken = new Map(
    [...byHolding].map(([id, payments]) => {
      const dates = payments.sort((a, b) =>
        a.date < b.date ? -1 : a.date > b.date ? 1 : 0,
      );
      const from: Exact[] = [];
      let sum = ZERO;
      for (let index = dates.length - 1; index >= 0; index -= 1) {
        sum = plus(sum, dates[index]!.amount);
        from[index] = sum;
      }
      return [id, { dates, from }];
    }),
  );
  const payments = { byDebt, taken, closed: closedIds(state), skipped };
  paymentsCache.set(state, payments);
  return payments;
}

// How many payments took cash from a holding the closes cannot give it back
// to: in another currency, not cash, deleted since or not read.
export const skippedCashPayments = (state: ClosesState): number =>
  debtPaymentsOf(state).skipped;

const figuresCache = new WeakMap<
  ClosesState,
  Map<string, Map<string, LiabilityBalance>>
>();

// Each debt's figures at the end of `date`, computed once per state and day.
function debtFiguresOn(
  state: ClosesState,
  date: string,
): Map<string, LiabilityBalance> {
  let byDate = figuresCache.get(state);
  if (!byDate) {
    byDate = new Map();
    figuresCache.set(state, byDate);
  }
  let figures = byDate.get(date);
  if (!figures) {
    figures = liabilityBalances(state.liabilities, state.liabilityEvents, date);
    byDate.set(date, figures);
  }
  return figures;
}

const owedCache = new WeakMap<ClosesState, Map<string, LiabilityOnDate[]>>();

// The debts as they stood at the end of `date`, computed once per state and
// day.
export function debtsOn(state: ClosesState, date: string): LiabilityOnDate[] {
  let byDate = owedCache.get(state);
  if (!byDate) {
    byDate = new Map();
    owedCache.set(state, byDate);
  }
  let owed = byDate.get(date);
  if (!owed) {
    owed = liabilitiesOn(state.liabilities, debtFiguresOn(state, date));
    byDate.set(date, owed);
  }
  return owed;
}

// The debts as they stand today.
export const debtsToday = (state: ClosesState): LiabilityOnDate[] =>
  debtsOn(state, state.today);

type HoldingLedger = {
  row: HoldingRow;
  movements: readonly Movement[];
  quantities: string[];
  flows: CashFlow[] | null;
  realized: (string | null)[];
};

type TradeDay = { date: string; price: QuoteSnapshot["prices"][string] };

// What every day's quotes are read from, built once per state: the stored
// rows by day and each key's stored dates, each instrument's trading days,
// and each day's quotes once read, which do not depend on the unit.
type Pricing = {
  need: QuoteNeed;
  rowsByDay: Map<string, StoredQuotes>;
  feedDays: FeedDays;
  trades: Map<string, TradeDay[]>;
  snapshots: Map<string, QuoteSnapshot>;
};

const pricingCache = new WeakMap<ClosesState, Pricing>();

function rowsByDayOf(quotes: StoredQuotes): Map<string, StoredQuotes> {
  const byDay = new Map<string, StoredQuotes>();
  const dayOf = (date: string) => {
    let day = byDay.get(date);
    if (!day) {
      day = { fxRates: [], prices: [] };
      byDay.set(date, day);
    }
    return day;
  };
  for (const row of quotes.fxRates) dayOf(row.rate_date).fxRates.push(row);
  for (const row of quotes.prices) dayOf(row.price_date).prices.push(row);
  return byDay;
}

// Each instrument's price on each of its trading days, oldest first, which
// values it on a day no feed or manual price covers: that day's purchases,
// sales and yields averaged by their units, so how they split across holdings
// or which was recorded first does not matter; in the currency most of them
// traded in. An opening balance's or an adjustment's price is a cost, not
// what a unit was worth.
function tradeDaysOf(state: ClosesState): Map<string, TradeDay[]> {
  const bySymbol = new Map<
    string,
    Map<string, Map<string, { units: Exact; worth: Exact }>>
  >();
  for (const row of allRows(state)) {
    if (row.holding.asset_class !== "instrument") continue;
    const symbol = row.holding.instrument_symbol;
    for (const movement of state.movements.get(row.id) ?? []) {
      if (
        (movement.kind !== "purchase" &&
          movement.kind !== "sale" &&
          movement.kind !== "yield") ||
        exactOf(movement.price).n === 0n
      ) {
        continue;
      }
      let days = bySymbol.get(symbol);
      if (!days) {
        days = new Map();
        bySymbol.set(symbol, days);
      }
      let byCurrency = days.get(movement.date);
      if (!byCurrency) {
        byCurrency = new Map();
        days.set(movement.date, byCurrency);
      }
      const units = exactOf(movement.quantity);
      const was = byCurrency.get(movement.currency);
      byCurrency.set(movement.currency, {
        units: plus(was?.units ?? ZERO, units),
        worth: plus(was?.worth ?? ZERO, times(units, exactOf(movement.price))),
      });
    }
  }
  return new Map(
    [...bySymbol].map(([symbol, days]) => [
      symbol,
      [...days]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([date, byCurrency]) => {
          const [currency, { units, worth }] = [...byCurrency].sort(
            ([a, x], [b, y]) =>
              compareExact(y.units, x.units) || (a < b ? -1 : 1),
          )[0]!;
          return {
            date,
            price: {
              price: stored(over(worth, units)),
              currency: currencySchema.parse(currency),
              date,
            },
          };
        }),
    ]),
  );
}

function pricingOf(state: ClosesState): Pricing {
  let pricing = pricingCache.get(state);
  if (!pricing) {
    pricing = {
      need: closesNeed(state),
      rowsByDay: rowsByDayOf(state.quotes),
      feedDays: feedDaysOf(state.quotes),
      trades: tradeDaysOf(state),
      snapshots: new Map(),
    };
    pricingCache.set(state, pricing);
  }
  return pricing;
}

// The index of the last of `items`, sorted by date, on or before `date`, or
// -1.
function lastOnOrBefore(
  items: readonly { date: string }[],
  date: string,
): number {
  let low = 0;
  let high = items.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (items[middle]!.date <= date) low = middle + 1;
    else high = middle;
  }
  return low - 1;
}

// A day's quotes as the closes value them: the stored ones of that day with
// the user's own prices and rates over them, and an instrument nothing quotes
// at its last trade price up to that day.
function pricedAt(state: ClosesState, date: string): QuoteSnapshot {
  const pricing = pricingOf(state);
  const kept = pricing.snapshots.get(date);
  if (kept) return kept;
  // Only the rows of the days the snapshot reads, each day's in stored order.
  const rows: StoredQuotes = { fxRates: [], prices: [] };
  for (let back = 0; back <= QUOTE_CARRY_DAYS; back += 1) {
    const day = pricing.rowsByDay.get(addDays(date, -back));
    if (!day) continue;
    rows.fxRates.push(...day.fxRates);
    rows.prices.push(...day.prices);
  }
  const quoted = pricedSnapshotOf(state, {
    ...snapshotOn(rows, date, pricing.need).snapshot,
    feedDates: feedDatesOn(pricing.feedDays, date, pricing.need),
  }).snapshot;
  const traded: QuoteSnapshot["prices"] = {};
  for (const [symbol, days] of pricing.trades) {
    const last = lastOnOrBefore(days, date);
    if (last >= 0) traded[symbol] = days[last]!.price;
  }
  const snapshot = {
    date: quoted.date,
    fx: quoted.fx,
    prices: { ...traded, ...quoted.prices },
  };
  pricing.snapshots.set(date, snapshot);
  return snapshot;
}

// Today's quotes as the closes value them, for what Resumen shows split
// today, so it adds up to the last close.
export const pricedToday = (state: ClosesState): QuoteSnapshot =>
  pricedAt(state, state.today);

// Each instrument holding's movements with what each left and paid, in `unit`.
function ledgersOf(state: ClosesState, unit: Denominator): HoldingLedger[] {
  return allRows(state).flatMap((row) => {
    const movements = state.movements.get(row.id);
    if (!movements?.length) return [];
    const steps = stepsOf(state, row.id, unit);
    return [
      {
        row,
        movements,
        quantities: steps.map((step) => step.position.quantity),
        flows: cashFlowsOf(movements, steps),
        // What a sale made, and what the units a yield took out had gained.
        realized: steps.map((step, index) => {
          const movement = movements[index]!;
          if (step.sale !== undefined) return step.sale?.result ?? null;
          return isYield(movement) && takesUnits(movement)
            ? moneyChange(positionBefore(steps, index), step, "realized")
            : "0";
        }),
      },
    ];
  });
}

// A holding row holding `quantity` units, as it stood on some day.
const rowAt = (row: HoldingRow, quantity: string): HoldingRow => ({
  ...row,
  holding: holdingSchema.parse({ ...row.holding, amount: quantity }),
});

// A holding that is not an instrument as it stood at the end of `date`, at
// today's amount; a cash one also with what debt payments after that day
// took from it, nothing of its own once closed (archiving keeps the amount
// it had).
export function otherAt(
  state: ClosesState,
  row: HoldingRow,
  date: string,
): HoldingRow[] {
  const { taken, closed } = debtPaymentsOf(state);
  const payments = taken.get(row.id);
  const after =
    payments?.from[lastOnOrBefore(payments.dates, date) + 1] ?? ZERO;
  if (row.holding.asset_class === "cash" && closed.has(row.id)) {
    return after.n === 0n ? [] : [rowAt(row, stored(after))];
  }
  if (after.n === 0n) return [row];
  return [rowAt(row, stored(plus(exactOf(row.holding.amount), after)))];
}

// The holdings as they stood at the end of `date`: an instrument holding with
// what its movements up to then left, a cash holding with today's amount
// plus what debt payments after that day took from it, and every other
// holding with today's amount on every past day; those that are not
// instruments as they stood at the end of `othersOn` when it is given.
function holdingsAt(
  state: ClosesState,
  ledgers: readonly HoldingLedger[],
  date: string,
  othersOn = date,
): HoldingRow[] {
  const byId = new Map(ledgers.map((ledger) => [ledger.row.id, ledger]));
  return allRows(state).flatMap((row) => {
    const ledger = byId.get(row.id);
    if (!ledger) return otherAt(state, row, othersOn);
    const last = lastOnOrBefore(ledger.movements, date);
    const quantity = last < 0 ? "0" : ledger.quantities[last]!;
    return exactOf(quantity).n === 0n ? [] : [rowAt(row, quantity)];
  });
}

// The holdings as they stood at the end of `date`, with that day's quotes as
// the closes value them.
export const heldOn = (
  state: ClosesState,
  date: string,
): { rows: HoldingRow[]; snapshot: QuoteSnapshot } => ({
  rows: holdingsAt(state, ledgersOf(state, "ars"), date),
  snapshot: pricedAt(state, date),
});

const cache = new WeakMap<ClosesState, Map<string, MonthClose[]>>();
const worthCache = new WeakMap<
  ClosesState,
  Map<Denominator, ReadonlyMap<string, string>>
>();
const worthsByUnit = (state: ClosesState) => {
  let byUnit = worthCache.get(state);
  if (!byUnit) {
    byUnit = new Map();
    worthCache.set(state, byUnit);
  }
  return byUnit;
};

// The movements of every holding the lists show, by holding.
const movementsShown = (state: ClosesState): (readonly Movement[])[] =>
  allRows(state).flatMap((row) => {
    const movements = state.movements.get(row.id);
    return movements?.length ? [movements] : [];
  });

// The day closes start from: the first movement's, else today.
const firstDay = (
  ledgers: readonly { movements: readonly Movement[] }[],
  today: string,
): string =>
  ledgers
    .map((ledger) => ledger.movements[0]!.date)
    .sort()
    .at(0) ?? today;

// The quotes closes value holdings and debts at: every dollar kind, the euro,
// the UVA, each instrument held and each instrument a debt is owed in.
export function closesNeed(state: ClosesState): QuoteNeed {
  const held = quotesNeeded(allRows(state).map((row) => row.holding));
  const owed = liabilityQuotesNeeded(state.liabilities);
  return {
    fxKinds: [...new Set([...held.fxKinds, ...owed.fxKinds, "uva" as const])],
    symbols: [...new Set([...held.symbols, ...owed.symbols])],
  };
}

// Every day closes value at, which `quotes` must cover: each month's start
// and end, and each day units came in already held or left without a trade.
export function closeDates(state: ClosesState): string[] {
  const movements = movementsShown(state);
  const days = monthsBetween(
    firstDay(
      movements.map((each) => ({ movements: each })),
      state.today,
    ),
    state.today,
  ).flatMap((month) => [month.from, month.to]);
  for (const movement of movements.flat()) {
    if (
      movement.kind === "opening_balance" ||
      (movement.kind === "adjustment" && movement.direction === "out")
    ) {
      days.push(movement.date);
    }
  }
  return [...new Set(days)].sort();
}

// What the debts did over a month, in `unit`, valued with its end quotes:
// the interest they accrued (a charge, out of the market result), and as
// flows dated at its end the payments no cash holding of the user's gave
// (money put in) and the rest of each change, new principal or a lender's
// correction (money taken out, or put in when it lowered the debt), so the
// market result keeps only what quotes did. A payment a cash holding gave
// leaves net worth as it was, and leaves what was held, so `held` pays it
// out on its day.
export function debtFlowsOf(
  state: ClosesState,
  unit: Denominator,
  month: Month,
  snapshot: QuoteSnapshot,
): { flows: CashFlow[]; held: CashFlow[]; interest: Exact; known: boolean } {
  const start = debtFiguresOn(state, month.from);
  const end = debtFiguresOn(state, month.to);
  const { byDebt } = debtPaymentsOf(state);
  const flows: CashFlow[] = [];
  const held: CashFlow[] = [];
  let interest = ZERO;
  let known = true;
  const flow = (kind: CashFlow["kind"], amount: Exact, date = month.to) => ({
    kind,
    date,
    amount: stored(amount),
    charges: "0",
  });
  for (const debt of state.liabilities) {
    // At the unit's precision, as net worth is.
    const valued = (amount: Exact): Exact => {
      if (amount.n === 0n) return ZERO;
      const value = valueLiabilities(
        liabilitiesOn(
          [debt],
          new Map([
            [debt.id, { ...end.get(debt.id)!, balance: stored(amount) }],
          ]),
        ),
        snapshot,
        { denominator: unit, referenceDollar: state.referenceDollar },
      );
      if (!value.complete) known = false;
      return exactOf(value.total);
    };
    let paid = ZERO;
    let outside = ZERO;
    for (const payment of byDebt.get(debt.id)?.get(month.period) ?? []) {
      paid = plus(paid, payment.amount);
      if (!payment.fromCash) outside = plus(outside, payment.amount);
      else held.push(flow("sell", valued(payment.amount), payment.date));
    }
    const change = liabilityChange(
      start.get(debt.id)!,
      end.get(debt.id)!,
      stored(paid),
    );
    interest = plus(interest, valued(exactOf(change.interest)));
    if (outside.n !== 0n) flows.push(flow("buy", negated(valued(outside))));
    const principal = exactOf(change.principal);
    if (principal.n !== 0n) {
      flows.push(flow(principal.n > 0n ? "sell" : "buy", valued(principal)));
    }
  }
  return { flows, held, interest, known };
}

// Every month's close in `unit`, oldest first, from the month of the first
// movement to the one in progress.
export function closesOf(state: ClosesState, unit: Denominator): MonthClose[] {
  let byUnit = cache.get(state);
  if (!byUnit) {
    byUnit = new Map();
    cache.set(state, byUnit);
  }
  const cached = byUnit.get(unit);
  if (cached) return cached;

  const ledgers = ledgersOf(state, unit);
  const first = firstDay(ledgers, state.today);
  // Net worth: what is held less what is owed, each as it stood that day. A
  // month's end is the next one's start, so each day is valued once.
  const values = new Map<
    string,
    { value: string; held: string; complete: boolean }
  >();
  const valueAt = (date: string) => {
    const kept = values.get(date);
    if (kept) return kept;
    const snapshot = pricedAt(state, date);
    const options = {
      denominator: unit,
      referenceDollar: state.referenceDollar,
    };
    const held = valueHoldings(
      holdingsAt(state, ledgers, date).map((row) => row.holding),
      snapshot,
      options,
    );
    const owed = valueLiabilities(debtsOn(state, date), snapshot, options);
    const value = {
      value: difference(held.total, owed.total),
      held: held.total,
      complete: held.complete && owed.complete,
    };
    values.set(date, value);
    return value;
  };
  // What each opening balance and adjustment out moved at, which the month's
  // detail shows.
  const worths = new Map<string, string>();
  // Units that come in already held (an opening balance) or leave the
  // holdings without a trade (an adjustment out) move at what they were worth
  // that day, exactly, so neither the gain they carry nor their cost shows as
  // the month's market result; a sale keeps its cost for what it makes. A
  // day with no price takes their cost.
  const flowOf = (
    ledger: HoldingLedger,
    index: number,
  ): { flow: CashFlow; priced: boolean } => {
    const flow = ledger.flows![index]!;
    const movement = ledger.movements[index]!;
    const out = movement.kind === "adjustment" && movement.direction === "out";
    if (movement.kind !== "opening_balance" && !out) {
      return { flow, priced: true };
    }
    const worth = valueHoldings(
      [rowAt(ledger.row, movement.quantity).holding],
      pricedAt(state, movement.date),
      { denominator: unit, referenceDollar: state.referenceDollar },
    );
    if (!worth.complete) return { flow, priced: false };
    worths.set(movement.id, stored(worth.exactTotal));
    const charges = exactOf(flow.charges);
    return {
      flow: {
        ...flow,
        amount: stored(
          out
            ? minus(worth.exactTotal, charges)
            : negated(plus(worth.exactTotal, charges)),
        ),
      },
      priced: true,
    };
  };

  // Each month's movements, holding by holding, oldest first: a month runs
  // from the day after the last one's end to its own end, today for the one
  // in progress.
  const byPeriod = new Map<string, [HoldingLedger, number][]>();
  for (const ledger of ledgers) {
    ledger.movements.forEach((movement, index) => {
      if (movement.date > state.today) return;
      const period = movement.date.slice(0, 7);
      const own = byPeriod.get(period) ?? [];
      own.push([ledger, index]);
      byPeriod.set(period, own);
    });
  }

  const closes = monthsBetween(first, state.today).map((month) => {
    const start = valueAt(month.from);
    const end = valueAt(month.to);
    const flows: CashFlow[] = [];
    const period = { from: month.from, to: month.to, flows };
    const realized: (string | null)[] = [];
    // Whether every movement of the month could be expressed in the unit,
    // and every opening balance and adjustment out priced on its day.
    let known = true;
    for (const [ledger, index] of byPeriod.get(month.period) ?? []) {
      if (ledger.flows) {
        const { flow, priced } = flowOf(ledger, index);
        flows.push(flow);
        if (!priced) known = false;
      } else known = false;
      realized.push(ledger.realized[index]!);
    }
    const debts = debtFlowsOf(state, unit, month, pricedAt(state, month.to));
    return {
      ...month,
      figures: {
        ...periodResult({
          ...period,
          flows: [...flows, ...debts.flows],
          interest: stored(debts.interest),
          startValue: start.value,
          endValue: end.value,
        }),
        // The return is what was held made: a debt counts in net worth but
        // earns nothing, and its balance moving is not a return.
        share: periodResult({
          ...period,
          flows: [...flows, ...debts.held],
          startValue: start.held,
          endValue: end.held,
        }).share,
      },
      realized: sumOrNull(realized),
      complete:
        start.complete &&
        end.complete &&
        known &&
        debts.known &&
        !state.partial,
      endComplete: end.complete,
      recalculatedOn: state.recalculated.get(month.period) ?? null,
      // A month that started with nothing held measures its return on part
      // of it only, so it is set against nothing, and its year leaves it out.
      ...(exactOf(start.held).n !== 0n && {
        benchmarks: benchmarksBetween(
          { day: month.from, snapshot: pricedAt(state, month.from) },
          { day: month.to, snapshot: pricedAt(state, month.to) },
        ),
      }),
    };
  });
  byUnit.set(unit, closes);
  worthsByUnit(state).set(unit, worths);
  return closes;
}

// Each year's months and their sums, newest year first.
export function yearsOfCloses(closes: readonly MonthClose[]): YearClose[] {
  const years = new Map<string, MonthClose[]>();
  for (const close of closes) {
    const year = close.period.slice(0, 4);
    years.set(year, [...(years.get(year) ?? []), close]);
  }
  return [...years]
    .map(([year, months]): YearClose => {
      const pick = (
        key:
          | "paidIn"
          | "proceeds"
          | "income"
          | "charges"
          | "contributed"
          | "market"
          | "result",
      ) => sumOrNull(months.map((each) => each.figures[key]))!;
      return {
        year,
        months,
        totals: {
          startValue: months[0]!.figures.startValue,
          endValue: months.at(-1)!.figures.endValue,
          paidIn: pick("paidIn"),
          proceeds: pick("proceeds"),
          income: pick("income"),
          charges: pick("charges"),
          contributed: pick("contributed"),
          market: pick("market"),
          result: pick("result"),
          realized: sumOrNull(months.map((each) => each.realized)),
          share: chainedShare(months.map((each) => each.figures.share)),
        },
        // A month whose return could not be measured has none of its own, so
        // the year's leaves it out and says so.
        complete: months.every(
          (each) => each.complete && each.figures.share !== null,
        ),
        open: months.some((each) => each.open),
        // Over the months whose return could be measured and that started
        // with something held.
        benchmarks: {
          inflation: chainedChange(
            months.flatMap((each) =>
              each.figures.share === null || !each.benchmarks
                ? []
                : [each.benchmarks.inflation],
            ),
          ),
          dollar: chainedChange(
            months.flatMap((each) =>
              each.figures.share === null || !each.benchmarks
                ? []
                : [each.benchmarks.dollar],
            ),
          ),
        },
      };
    })
    .reverse();
}

// A month's close and its movements, newest first.
export function monthDetail(
  state: ClosesState,
  unit: Denominator,
  period: string,
): MonthDetail | null {
  const close = closesOf(state, unit).find((each) => each.period === period);
  if (!close) return null;
  // Units that came in already held or left without a trade show at what
  // they were worth that day, as the close counts them.
  const worths = worthsByUnit(state).get(unit);
  const names = instrumentNames(state.instruments);
  const lines: MonthDetail["lines"] = [];
  for (const ledger of ledgersOf(state, unit)) {
    const steps = stepsOf(state, ledger.row.id, unit);
    ledger.movements.forEach((movement, index) => {
      if (movement.date <= close.from || movement.date > close.to) return;
      const line = lineOf(
        movement,
        positionBefore(steps, index),
        steps[index]!,
        operationOf(state, movement.operation_id)!,
      );
      const worth = worths?.get(movement.id);
      lines.push({
        ...line,
        amount: worth ?? line.amount,
        atWorth: worth !== undefined,
        holdingName: `${holdingName(ledger.row.holding, names)} · ${ledger.row.account.institution}`,
        instrumentType: ledger.row.instrumentType,
      });
    });
  }
  lines.sort((a, b) => compareMovements(b.movement, a.movement));
  return { close, lines };
}

// Where net worth's change over consecutive months came from, in one unit:
// what was put in (or taken out), what prices did, what the dollar did, what
// yields added and what the debts' interest cost (negative), which add up to
// the change exactly. The dollar's part is what the instruments held at
// each month's end, and the debts and the cash their payments took at its
// start, were worth at its end quotes less what they were worth with the
// dollar rates of its start and the same prices; the prices' part is the
// rest of the market result, so a peso price that follows the dollar (a
// CEDEAR) counts as price. Income paid out (dividends, coupons and rents,
// without yields) and charges are listed apart.
export type ChangeBetween = {
  from: string;
  to: string;
  months: number;
  open: boolean;
  startValue: string;
  endValue: string;
  contributed: string;
  prices: string;
  dollar: string;
  yields: string;
  // What the debts' interest cost, negative; a close's figures carry it
  // positive, inside charges.
  interest: string;
  income: string;
  charges: string;
  result: string;
  realized: string | null;
  share: string | null;
  benchmarks: Benchmarks;
  complete: boolean;
};

// The months from `from` to `to` (periods, "2026-09"), in either order; null
// when no close falls between them.
export function changeBetween(
  state: ClosesState,
  unit: Denominator,
  from: string,
  to: string,
): ChangeBetween | null {
  const [first, last] = from <= to ? [from, to] : [to, from];
  const months = closesOf(state, unit).filter(
    (each) => each.period >= first && each.period <= last,
  );
  if (months.length === 0) return null;
  const ledgers = ledgersOf(state, unit);
  const options = { denominator: unit, referenceDollar: state.referenceDollar };
  // The debts, and the cash their payments took, as they stood at the month's
  // start: their flows are valued with its end quotes, so only those amounts
  // moved with the dollar.
  const worthAt = (date: string, owedOn: string, snapshot: QuoteSnapshot) => {
    const held = valueHoldings(
      holdingsAt(state, ledgers, date, owedOn).map((row) => row.holding),
      snapshot,
      options,
    );
    const owed = valueLiabilities(debtsOn(state, owedOn), snapshot, options);
    return {
      value: exactOf(difference(held.total, owed.total)),
      complete: held.complete && owed.complete,
    };
  };
  let dollar = ZERO;
  let yields = ZERO;
  let known = true;
  for (const month of months) {
    const end = pricedAt(state, month.to);
    const start = pricedAt(state, month.from);
    const fx = { ...end.fx };
    for (const kind of VALUED_FX_KINDS) {
      const now = end.fx[kind];
      const was = start.fx[kind];
      if (now && was) fx[kind] = { ...now, sell: was.sell };
      else if (now) known = false;
    }
    const atEnd = worthAt(month.to, month.from, end);
    const atStartRates = worthAt(month.to, month.from, { ...end, fx });
    if (!atEnd.complete || !atStartRates.complete) known = false;
    dollar = plus(dollar, minus(atEnd.value, atStartRates.value));
    const { startValue, endValue, contributed, market } = month.figures;
    yields = plus(
      yields,
      minus(
        minus(exactOf(endValue), exactOf(startValue)),
        plus(exactOf(contributed), exactOf(market)),
      ),
    );
  }
  const sum = (
    key: "contributed" | "market" | "income" | "charges" | "result",
  ) => plus(...months.map((each) => exactOf(each.figures[key])));
  // The debts' interest lowered net worth without being in the market
  // result, so the residual holds it too; it is shown apart, as a cost.
  const interest = negated(
    plus(...months.map((each) => exactOf(each.figures.interest))),
  );
  yields = minus(yields, interest);
  // Over the months whose return could be measured and that started with
  // something held, as a year's are.
  const measured = months.flatMap((each) =>
    each.figures.share === null || !each.benchmarks ? [] : [each.benchmarks],
  );
  return {
    from: months[0]!.period,
    to: months.at(-1)!.period,
    months: months.length,
    open: months.some((each) => each.open),
    startValue: months[0]!.figures.startValue,
    endValue: months.at(-1)!.figures.endValue,
    contributed: stored(sum("contributed")),
    prices: stored(minus(sum("market"), dollar)),
    dollar: stored(dollar),
    yields: stored(yields),
    interest: stored(interest),
    // What was paid out; what yields added is in `yields`, not here too.
    income: stored(minus(sum("income"), yields)),
    charges: stored(sum("charges")),
    result: stored(sum("result")),
    realized: sumOrNull(months.map((each) => each.realized)),
    share: chainedShare(months.map((each) => each.figures.share)),
    benchmarks: {
      inflation: chainedChange(measured.map((each) => each.inflation)),
      dollar: chainedChange(measured.map((each) => each.dollar)),
    },
    complete: known && months.every((each) => each.complete),
  };
}
