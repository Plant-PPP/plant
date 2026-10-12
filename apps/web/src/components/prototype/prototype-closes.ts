import {
  type CashFlow,
  cashFlowsOf,
  chainedShare,
  compareMovements,
  type Denominator,
  EMPTY_POSITION,
  holdingSchema,
  admitMovements,
  type Movement,
  type QuoteSnapshot,
  periodResult,
  quotesNeeded,
  snapshotOn,
  valueHoldings,
  valueLiabilities,
  withManualPrices,
} from "@plant/core";
import {
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
  toDecimal,
  ZERO,
} from "@plant/shared";

import { holdingName, instrumentNames } from "@/lib/holdings/holding-name";
import type { HoldingRow } from "@/lib/holdings/read";
import { holdingsValuation } from "@/lib/holdings/valuation-view";
import {
  CLOSE_UNITS,
  type MonthClose,
  type MonthDetail,
  monthsBetween,
  type YearClose,
} from "@/lib/summary/closes";

import {
  allRows,
  difference,
  lineOf,
  operationOf,
  type PrototypeState,
  stepsOf,
} from "./prototype-store";

type Ledger = {
  row: HoldingRow;
  movements: readonly Movement[];
  quantities: string[];
  flows: CashFlow[] | null;
  realized: (string | null)[];
};

// Each instrument holding's movements with what each left and paid, in `unit`.
function ledgersOf(state: PrototypeState, unit: Denominator): Ledger[] {
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
        realized: steps.map((step) =>
          step.sale === undefined ? "0" : (step.sale?.result ?? null),
        ),
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
  state: PrototypeState,
  ledgers: readonly Ledger[],
  date: string,
): HoldingRow[] {
  const byId = new Map(ledgers.map((ledger) => [ledger.row.id, ledger]));
  return allRows(state).flatMap((row) => {
    const ledger = byId.get(row.id);
    if (!ledger) return [row];
    let last = -1;
    while (
      last + 1 < ledger.movements.length &&
      ledger.movements[last + 1]!.date <= date
    ) {
      last += 1;
    }
    const quantity = last < 0 ? "0" : ledger.quantities[last]!;
    return exactOf(quantity).n === 0n ? [] : [rowAt(row, quantity)];
  });
}

// Each instrument's price on its latest trading day up to `date`, which
// values it on a day no feed or manual price covers: that day's purchases
// and sales averaged by their units, so how they split across holdings or
// which was recorded first does not matter; in the currency most of them
// traded in. An opening balance's or an adjustment's price is a cost, not a
// trade's.
function lastTradePrices(
  ledgers: readonly Ledger[],
  date: string,
): QuoteSnapshot["prices"] {
  type Day = {
    date: string;
    byCurrency: Map<string, { units: Exact; worth: Exact }>;
  };
  const latest = new Map<string, Day>();
  for (const { row, movements } of ledgers) {
    if (row.holding.asset_class !== "instrument") continue;
    const symbol = row.holding.instrument_symbol;
    for (const movement of movements) {
      if (
        movement.date > date ||
        (movement.kind !== "purchase" && movement.kind !== "sale") ||
        exactOf(movement.price).n === 0n
      ) {
        continue;
      }
      const kept = latest.get(symbol);
      if (kept && kept.date > movement.date) continue;
      const day =
        kept?.date === movement.date
          ? kept
          : { date: movement.date, byCurrency: new Map() };
      const units = exactOf(movement.quantity);
      const was = day.byCurrency.get(movement.currency);
      day.byCurrency.set(movement.currency, {
        units: plus(was?.units ?? ZERO, units),
        worth: plus(was?.worth ?? ZERO, times(units, exactOf(movement.price))),
      });
      latest.set(symbol, day);
    }
  }
  return Object.fromEntries(
    [...latest].map(([symbol, day]) => {
      const [currency, { units, worth }] = [...day.byCurrency].sort(
        ([a, x], [b, y]) => compareExact(y.units, x.units) || (a < b ? -1 : 1),
      )[0]!;
      return [
        symbol,
        {
          price: stored(over(worth, units)),
          currency: currencySchema.parse(currency),
          date: day.date,
        },
      ];
    }),
  );
}

const cache = new WeakMap<PrototypeState, Map<string, MonthClose[]>>();
const worthCache = new WeakMap<
  PrototypeState,
  Map<Denominator, ReadonlyMap<string, string>>
>();
const worthsByUnit = (state: PrototypeState) => {
  let byUnit = worthCache.get(state);
  if (!byUnit) {
    byUnit = new Map();
    worthCache.set(state, byUnit);
  }
  return byUnit;
};

// Every month's close in `unit`, oldest first, from the month of the first
// movement to the one in progress.
export function closesOf(
  state: PrototypeState,
  unit: Denominator,
): MonthClose[] {
  let byUnit = cache.get(state);
  if (!byUnit) {
    byUnit = new Map();
    cache.set(state, byUnit);
  }
  const cached = byUnit.get(unit);
  if (cached) return cached;

  const ledgers = ledgersOf(state, unit);
  const first =
    ledgers
      .map((ledger) => ledger.movements[0]!.date)
      .sort()
      .at(0) ?? state.today;
  const need = quotesNeeded(allRows(state).map((row) => row.holding));
  const snapshotAt = (date: string): QuoteSnapshot => {
    const quoted = withManualPrices(
      snapshotOn(state.quotes, date, {
        ...need,
        fxKinds: [...need.fxKinds, "uva"],
        symbols: state.instruments.map(({ symbol }) => symbol),
      }).snapshot,
      state.manualPrices,
    ).snapshot;
    return {
      ...quoted,
      prices: { ...lastTradePrices(ledgers, date), ...quoted.prices },
    };
  };
  const valued = (holdings: HoldingRow[], date: string) => {
    const snapshot = snapshotAt(date);
    const total = holdingsValuation({
      holdings,
      truncated: false,
      snapshot,
      unit,
      referenceDollar: state.referenceDollar,
    }).kinds.total;
    return { value: total.value, complete: total.complete, snapshot };
  };
  // Net worth: what is held less what is owed. A debt keeps today's balance
  // on every past day, in its own unit, until debts have a history.
  const valueAt = (date: string) => {
    const held = valued(holdingsAt(state, ledgers, date), date);
    const owed = valueLiabilities(state.liabilities, held.snapshot, {
      denominator: unit,
      referenceDollar: state.referenceDollar,
    });
    return {
      value: difference(held.value, owed.total),
      held: held.value,
      complete: held.complete && owed.complete,
    };
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
    ledger: Ledger,
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
      snapshotAt(movement.date),
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

  const closes = monthsBetween(first, state.today).map((month) => {
    const start = valueAt(month.from);
    const end = valueAt(month.to);
    const inMonth = (date: string) => date > month.from && date <= month.to;
    const flows: CashFlow[] = [];
    const period = { from: month.from, to: month.to, flows };
    const realized: (string | null)[] = [];
    // Whether every movement of the month could be expressed in the unit,
    // and every opening balance and adjustment out priced on its day.
    let known = true;
    for (const ledger of ledgers) {
      ledger.movements.forEach((movement, index) => {
        if (!inMonth(movement.date)) return;
        if (ledger.flows) {
          const { flow, priced } = flowOf(ledger, index);
          flows.push(flow);
          if (!priced) known = false;
        } else known = false;
        realized.push(ledger.realized[index]!);
      });
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
      };
    })
    .reverse();
}

// A month's close and its movements, newest first.
export function monthDetail(
  state: PrototypeState,
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
    ledger.movements.forEach((movement, index) => {
      if (movement.date <= close.from || movement.date > close.to) return;
      const steps = stepsOf(state, ledger.row.id, unit);
      const line = lineOf(
        movement,
        index === 0 ? EMPTY_POSITION : steps[index - 1]!.position,
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

// What a write to a month or an earlier one changes in its close. A write
// moves no quote, so every value that moved, moved because of it: the
// month's figures to the cent (so how a figure splits across portfolios does
// not show), plus its own movements and the units held at its end, per
// account and instrument so moving units between portfolios changes nothing.
function movedBy(state: PrototypeState, close: MonthClose): string {
  const own = new Map<string, Exact[]>();
  const held = new Map<string, Exact>();
  for (const each of state.holdings) {
    if (each.holding.asset_class !== "instrument") continue;
    const at = JSON.stringify([each.accountId, each.holding.instrument_symbol]);
    const upTo = (state.movements.get(each.holding.id) ?? []).filter(
      (movement) => movement.date <= close.to,
    );
    const admitted = admitMovements({ prior: null, after: upTo });
    if (admitted.ok && exactOf(admitted.quantity).n !== 0n) {
      held.set(at, plus(held.get(at) ?? ZERO, exactOf(admitted.quantity)));
    }
    for (const movement of upTo) {
      if (movement.date <= close.from) continue;
      const key = JSON.stringify([
        at,
        movement.operation_id,
        movement.kind,
        movement.date,
        movement.currency,
        "price" in movement ? movement.price : null,
        "direction" in movement ? movement.direction : null,
      ]);
      const [size = ZERO, charges = ZERO] = own.get(key) ?? [];
      own.set(key, [
        plus(
          size,
          exactOf("quantity" in movement ? movement.quantity : movement.amount),
        ),
        plus(charges, ...movement.charges.map(({ amount }) => exactOf(amount))),
      ]);
    }
  }
  const cents = (value: string | null) =>
    value === null ? null : toDecimal(exactOf(value), 2);
  const { figures } = close;
  return JSON.stringify([
    [...own]
      .map(([key, [size, charges]]) => [key, stored(size!), stored(charges!)])
      .sort(),
    [...held].map(([key, units]) => [key, stored(units)]).sort(),
    [
      figures.startValue,
      figures.endValue,
      figures.paidIn,
      figures.proceeds,
      figures.income,
      figures.charges,
      close.realized,
    ].map(cents),
  ]);
}

// The closed months whose figures or own movements a write changed, in any
// unit closes are shown in (a dollar movement's date moves its pesos, not its
// dollars), marked as recalculated today; the month in progress is never
// marked.
export function markRecalculated(
  before: PrototypeState,
  after: PrototypeState,
): PrototypeState {
  if (before.movements === after.movements) return after;
  const changed = new Set<string>();
  for (const unit of CLOSE_UNITS) {
    const was = new Map(
      closesOf(before, unit).map((each) => [
        each.period,
        movedBy(before, each),
      ]),
    );
    for (const each of closesOf(after, unit)) {
      if (
        !each.open &&
        was.has(each.period) &&
        was.get(each.period) !== movedBy(after, each)
      ) {
        changed.add(each.period);
      }
    }
  }
  if (changed.size === 0) return after;
  const recalculated = new Map(after.recalculated);
  for (const period of changed) recalculated.set(period, after.today);
  return { ...after, recalculated };
}
