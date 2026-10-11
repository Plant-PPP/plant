import {
  type CashFlow,
  cashFlowsOf,
  chainedShare,
  compareMovements,
  type Denominator,
  EMPTY_POSITION,
  holdingSchema,
  isTrade,
  type Movement,
  type QuoteSnapshot,
  periodResult,
  quotesNeeded,
  snapshotOn,
  type Trade,
  valueLiabilities,
  withManualPrices,
} from "@plant/core";
import {
  type Exact,
  exactOf,
  plus,
  stored,
  sumOrNull,
  ZERO,
} from "@plant/shared";

import { holdingName, instrumentNames } from "@/lib/holdings/holding-name";
import type { HoldingRow } from "@/lib/holdings/read";
import { holdingsValuation } from "@/lib/holdings/valuation-view";
import {
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
    if (exactOf(quantity).n === 0n) return [];
    return [
      {
        ...row,
        holding: holdingSchema.parse({ ...row.holding, amount: quantity }),
      },
    ];
  });
}

// Each instrument's price in its latest purchase, sale or opening balance
// with a price, up to `date`, which values it on a day no feed or manual
// price covers. An adjustment's price is a cost, not a trade's.
function lastTradePrices(
  ledgers: readonly Ledger[],
  date: string,
): QuoteSnapshot["prices"] {
  const latest = new Map<string, Trade>();
  for (const { row, movements } of ledgers) {
    if (row.holding.asset_class !== "instrument") continue;
    for (const movement of movements) {
      if (
        movement.date > date ||
        !isTrade(movement) ||
        movement.kind === "adjustment" ||
        exactOf(movement.price).n === 0n
      ) {
        continue;
      }
      const kept = latest.get(row.holding.instrument_symbol);
      if (!kept || kept.date <= movement.date) {
        latest.set(row.holding.instrument_symbol, movement);
      }
    }
  }
  return Object.fromEntries(
    [...latest].map(([symbol, movement]) => [
      symbol,
      {
        price: movement.price,
        currency: movement.currency,
        date: movement.date,
      },
    ]),
  );
}

const cache = new WeakMap<PrototypeState, Map<string, MonthClose[]>>();

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
  const valueAt = (date: string) => {
    const quoted = withManualPrices(
      snapshotOn(state.quotes, date, {
        ...need,
        fxKinds: [...need.fxKinds, "uva"],
        symbols: state.instruments.map(({ symbol }) => symbol),
      }).snapshot,
      state.manualPrices,
    ).snapshot;
    const snapshot = {
      ...quoted,
      prices: { ...lastTradePrices(ledgers, date), ...quoted.prices },
    };
    const total = holdingsValuation({
      holdings: holdingsAt(state, ledgers, date),
      truncated: false,
      snapshot,
      unit,
      referenceDollar: state.referenceDollar,
    }).kinds.total;
    // Net worth: what is held less what is owed. A debt keeps today's balance
    // on every past day, in its own unit, until debts have a history.
    const owed = valueLiabilities(state.liabilities, snapshot, {
      denominator: unit,
      referenceDollar: state.referenceDollar,
    });
    return {
      value: difference(total.value, owed.total),
      complete: total.complete && owed.complete,
    };
  };

  const closes = monthsBetween(first, state.today).map((month) => {
    const start = valueAt(month.from);
    const end = valueAt(month.to);
    const inMonth = (date: string) => date > month.from && date <= month.to;
    const flows: CashFlow[] = [];
    const realized: (string | null)[] = [];
    let known = true;
    for (const ledger of ledgers) {
      if (!ledger.flows) known = false;
      ledger.movements.forEach((movement, index) => {
        if (!inMonth(movement.date)) return;
        if (ledger.flows) flows.push(ledger.flows[index]!);
        realized.push(ledger.realized[index]!);
      });
    }
    return {
      ...month,
      figures: periodResult({
        from: month.from,
        to: month.to,
        startValue: start.value,
        endValue: end.value,
        flows,
      }),
      realized: sumOrNull(realized),
      complete: start.complete && end.complete && known,
      recalculatedOn: state.recalculated.get(month.period) ?? null,
    };
  });
  byUnit.set(unit, closes);
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
        complete: months.every((each) => each.complete),
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
  const names = instrumentNames(state.instruments);
  const lines: MonthDetail["lines"] = [];
  for (const ledger of ledgersOf(state, unit)) {
    ledger.movements.forEach((movement, index) => {
      if (movement.date <= close.from || movement.date > close.to) return;
      const steps = stepsOf(state, ledger.row.id, unit);
      lines.push({
        ...lineOf(
          movement,
          index === 0 ? EMPTY_POSITION : steps[index - 1]!.position,
          steps[index]!,
          operationOf(state, movement.operation_id)!,
        ),
        holdingName: `${holdingName(ledger.row.holding, names)} · ${ledger.row.account.institution}`,
        instrumentType: ledger.row.instrumentType,
      });
    });
  }
  lines.sort((a, b) => compareMovements(b.movement, a.movement));
  return { close, lines };
}

// What a write to a month or an earlier one changes in its close: the
// month's own movements, per account and instrument so moving units between
// portfolios changes nothing, and what its sales made, which an earlier
// purchase sets. Its values move with every price and balance, so they are
// left out.
function movedBy(state: PrototypeState, close: MonthClose): string {
  const own = new Map<string, Exact[]>();
  for (const held of state.holdings) {
    if (held.holding.asset_class !== "instrument") continue;
    for (const movement of state.movements.get(held.holding.id) ?? []) {
      if (movement.date <= close.from || movement.date > close.to) continue;
      const key = JSON.stringify([
        held.accountId,
        held.holding.instrument_symbol,
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
  return JSON.stringify([
    [...own]
      .map(([key, [size, charges]]) => [key, stored(size!), stored(charges!)])
      .sort(),
    close.realized,
  ]);
}

// The closed months whose movements a write changed, marked as recalculated
// today; the month in progress is never marked.
export function markRecalculated(
  before: PrototypeState,
  after: PrototypeState,
  unit: Denominator,
): PrototypeState {
  if (before.movements === after.movements) return after;
  const was = new Map(
    closesOf(before, unit).map((each) => [each.period, movedBy(before, each)]),
  );
  const changed = closesOf(after, unit).filter(
    (each) =>
      !each.open &&
      was.has(each.period) &&
      was.get(each.period) !== movedBy(after, each),
  );
  if (changed.length === 0) return after;
  const recalculated = new Map(after.recalculated);
  for (const each of changed) recalculated.set(each.period, after.today);
  return { ...after, recalculated };
}
