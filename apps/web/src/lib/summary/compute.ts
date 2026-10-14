import {
  type Benchmarks,
  benchmarksBetween,
  chainedChange,
} from "./benchmarks";
import {
  type CashFlow,
  cashFlowsOf,
  chainedShare,
  compareMovements,
  type Denominator,
  holdingSchema,
  isYield,
  type Liability,
  liabilityQuotesNeeded,
  type Movement,
  type QuoteNeed,
  type QuoteSnapshot,
  periodResult,
  QUOTE_CARRY_DAYS,
  quotesNeeded,
  type StoredQuotes,
  snapshotOn,
  takesUnits,
  UNIT_FX_KINDS,
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
  type MonthClose,
  type MonthDetail,
  monthsBetween,
  type YearClose,
} from "@/lib/summary/closes";

// What closes are computed from: the ledger, with stored quotes covering
// every day closeDates names, the debts, and the closed months a write
// changed, by period, with the day it did.
export type ClosesState = Ledger & {
  liabilities: readonly Liability[];
  recalculated: ReadonlyMap<string, string>;
};

type HoldingLedger = {
  row: HoldingRow;
  movements: readonly Movement[];
  quantities: string[];
  flows: CashFlow[] | null;
  realized: (string | null)[];
};

type TradeDay = { date: string; price: QuoteSnapshot["prices"][string] };

// What every day's quotes are read from, built once per state: the stored
// rows by day, each instrument's trading days, and each day's quotes once
// read, which do not depend on the unit.
type Pricing = {
  need: QuoteNeed;
  rowsByDay: Map<string, StoredQuotes>;
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
  const quoted = pricedSnapshotOf(
    state,
    snapshotOn(rows, date, pricing.need).snapshot,
  ).snapshot;
  const traded: QuoteSnapshot["prices"] = {};
  for (const [symbol, days] of pricing.trades) {
    const last = lastOnOrBefore(days, date);
    if (last >= 0) traded[symbol] = days[last]!.price;
  }
  const snapshot = { ...quoted, prices: { ...traded, ...quoted.prices } };
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

// The holdings as they stood at the end of `date`: an instrument holding with
// what its movements up to then left, and every other holding with today's
// amount on every past day, until those holdings have a history.
function holdingsAt(
  state: ClosesState,
  ledgers: readonly HoldingLedger[],
  date: string,
): HoldingRow[] {
  const byId = new Map(ledgers.map((ledger) => [ledger.row.id, ledger]));
  return allRows(state).flatMap((row) => {
    const ledger = byId.get(row.id);
    if (!ledger) return [row];
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

// The quotes closes value holdings and debts at: every dollar kind and the
// UVA, each instrument held and each instrument a debt is owed in.
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
  // Net worth: what is held less what is owed. A debt keeps today's balance
  // on every past day, in its own unit, until debts have a history. A
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
    const owed = valueLiabilities(state.liabilities, snapshot, options);
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
    return {
      ...month,
      figures: {
        ...periodResult({
          ...period,
          startValue: start.value,
          endValue: end.value,
        }),
        // The return is what was held made: a debt counts in net worth but
        // earns nothing, and its balance moving is not a return.
        share: periodResult({
          ...period,
          startValue: start.held,
          endValue: end.held,
        }).share,
      },
      realized: sumOrNull(realized),
      complete: start.complete && end.complete && known,
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
// what was put in (or taken out), what prices did, what the dollar did and
// what yields added, which add up to the change exactly. The dollar's part is
// what the holdings and debts at each month's end were worth at its end quotes
// less what they were worth with the dollar rates of its start and the same
// prices; the prices' part is the rest of the market result, so a peso price
// that follows the dollar (a CEDEAR) counts as price. Income paid out
// (dividends, coupons and rents, without yields) and charges are listed
// apart.
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
  const worthAt = (date: string, snapshot: QuoteSnapshot) => {
    const held = valueHoldings(
      holdingsAt(state, ledgers, date).map((row) => row.holding),
      snapshot,
      options,
    );
    const owed = valueLiabilities(state.liabilities, snapshot, options);
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
    for (const kind of UNIT_FX_KINDS) {
      const now = end.fx[kind];
      const was = start.fx[kind];
      if (now && was) fx[kind] = { ...now, sell: was.sell };
      else if (now) known = false;
    }
    const atEnd = worthAt(month.to, end);
    const atStartRates = worthAt(month.to, { ...end, fx });
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
