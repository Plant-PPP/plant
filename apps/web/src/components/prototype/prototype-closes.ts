import {
  type CashFlow,
  cashFlowsOf,
  chainedShare,
  compareMovements,
  type Denominator,
  holdingSchema,
  isIncome,
  isTrade,
  type Movement,
  type QuoteSnapshot,
  periodResult,
  quotesNeeded,
  snapshotOn,
  takesUnits,
  withManualPrices,
} from "@plant/core";
import { exactOf, plus, toDecimal } from "@plant/shared";

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
  operationOf,
  type PrototypeState,
  stepsOf,
} from "./prototype-store";

const sum = (values: readonly (string | null)[]): string | null =>
  values.includes(null)
    ? null
    : toDecimal(plus(...values.map((value) => exactOf(value!))), 8);
const minus = (a: string, b: string) =>
  toDecimal(plus(exactOf(a), { ...exactOf(b), n: -exactOf(b).n }), 8);

type Ledger = {
  row: HoldingRow;
  movements: readonly Movement[];
  quantities: string[];
  flows: CashFlow[] | null;
  charges: (string | null)[];
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
        charges: steps.map((step, index) => {
          const now = step.position.money;
          const was = index === 0 ? null : steps[index - 1]!.position.money;
          if (!now) return null;
          return minus(now.charges, was?.charges ?? "0");
        }),
        realized: steps.map((step) =>
          step.sale === undefined ? "0" : (step.sale?.result ?? null),
        ),
      },
    ];
  });
}

// The holdings as they stood at the end of `date`: an instrument holding with
// what its movements up to then left, the rest as they are.
function holdingsAt(
  state: PrototypeState,
  ledgers: readonly Ledger[],
  date: string,
): HoldingRow[] {
  const byId = new Map(ledgers.map((ledger) => [ledger.row.id, ledger]));
  return allRows(state).flatMap((row) => {
    const ledger = byId.get(row.id);
    if (!ledger) {
      return row.holding.asset_class === "instrument" ? [] : [row];
    }
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

// Each instrument's price in its latest purchase or sale up to `date`, which
// values it on a day no feed or manual price covers.
function lastTradePrices(
  ledgers: readonly Ledger[],
  date: string,
): QuoteSnapshot["prices"] {
  const latest = new Map<string, Movement>();
  for (const { row, movements } of ledgers) {
    if (row.holding.asset_class !== "instrument") continue;
    for (const movement of movements) {
      if (movement.date > date || !isTrade(movement)) continue;
      const kept = latest.get(row.holding.instrument_symbol);
      if (!kept || kept.date <= movement.date) {
        latest.set(row.holding.instrument_symbol, movement);
      }
    }
  }
  return Object.fromEntries(
    [...latest].flatMap(([symbol, movement]) =>
      isTrade(movement) && exactOf(movement.price).n > 0n
        ? [
            [
              symbol,
              {
                price: movement.price,
                currency: movement.currency,
                date: movement.date,
              },
            ],
          ]
        : [],
    ),
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
    return { value: total.value, complete: total.complete };
  };

  const closes = monthsBetween(first, state.today).map((month) => {
    const start = valueAt(month.from);
    const end = valueAt(month.to);
    const inMonth = (date: string) => date > month.from && date <= month.to;
    const flows: CashFlow[] = [];
    const charges: (string | null)[] = [];
    const realized: (string | null)[] = [];
    let known = true;
    for (const ledger of ledgers) {
      if (!ledger.flows) known = false;
      ledger.movements.forEach((movement, index) => {
        if (!inMonth(movement.date)) return;
        if (ledger.flows) flows.push(ledger.flows[index]!);
        charges.push(ledger.charges[index]!);
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
      charges: sum(charges),
      realized: sum(realized),
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
        key: "paidIn" | "proceeds" | "income" | "contributed" | "market",
      ) => sum(months.map((each) => each.figures[key]))!;
      const market = pick("market");
      const income = pick("income");
      return {
        year,
        months,
        totals: {
          startValue: months[0]!.figures.startValue,
          endValue: months.at(-1)!.figures.endValue,
          paidIn: pick("paidIn"),
          proceeds: pick("proceeds"),
          income,
          contributed: pick("contributed"),
          market,
          result: sum([market, income])!,
          charges: sum(months.map((each) => each.charges)),
          realized: sum(months.map((each) => each.realized)),
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
      const charges = ledger.charges[index] ?? null;
      const steps = stepsOf(state, ledger.row.id, unit);
      const now = steps[index]!.position.money;
      const was = index === 0 ? null : steps[index - 1]!.position.money;
      const cost =
        !now || (index > 0 && !was)
          ? null
          : isIncome(movement.kind)
            ? minus(now.income, was?.income ?? "0")
            : takesUnits(movement)
              ? minus(was?.cost ?? "0", now.cost)
              : minus(now.cost, was?.cost ?? "0");
      lines.push({
        movement,
        cost,
        charges,
        operation: operationOf(state, movement.operation_id)!,
        holdingName: `${holdingName(ledger.row.holding, names)} · ${ledger.row.account.institution}`,
      });
    });
  }
  lines.sort((a, b) => compareMovements(b.movement, a.movement));
  return { close, lines };
}

// The closed months whose figures a write changed, marked as recalculated
// today; the month in progress is never marked.
export function markRecalculated(
  before: PrototypeState,
  after: PrototypeState,
  unit: Denominator,
): PrototypeState {
  const was = new Map(
    closesOf(before, unit).map((each) => [
      each.period,
      JSON.stringify(each.figures),
    ]),
  );
  const changed = closesOf(after, unit).filter(
    (each) =>
      !each.open &&
      was.has(each.period) &&
      was.get(each.period) !== JSON.stringify(each.figures),
  );
  if (changed.length === 0) return after;
  const recalculated = new Map(after.recalculated);
  for (const each of changed) recalculated.set(each.period, after.today);
  return { ...after, recalculated };
}
