// The closes as they were computed before PLA-139, kept verbatim as the
// oracle the optimized ones must match.
import {
  type CashFlow,
  cashFlowsOf,
  compareMovements,
  type Denominator,
  holdingSchema,
  isYield,
  type Movement,
  type QuoteSnapshot,
  periodResult,
  snapshotOn,
  takesUnits,
  valueHoldings,
  valueLiabilities,
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
  ZERO,
} from "@plant/shared";

import { holdingName, instrumentNames } from "@/lib/holdings/holding-name";
import type { HoldingRow } from "@/lib/holdings/read";
import { holdingsValuation } from "@/lib/holdings/valuation-view";
import {
  allRows,
  difference,
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
} from "@/lib/summary/closes";
import {
  type ClosesState,
  closesNeed,
  debtsToday,
} from "@/lib/summary/compute";

type HoldingLedger = {
  row: HoldingRow;
  movements: readonly Movement[];
  quantities: string[];
  flows: CashFlow[] | null;
  realized: (string | null)[];
};

// Each instrument holding's movements with what each left and paid, in `unit`.
// A day's quotes as the closes value them: the stored ones of that day with
// the user's own prices and rates over them, and an instrument nothing quotes
// at its last trade price up to that day.
function pricedAt(
  state: ClosesState,
  ledgers: readonly Pick<HoldingLedger, "row" | "movements">[],
  date: string,
  need: ReturnType<typeof closesNeed>,
): QuoteSnapshot {
  const quoted = pricedSnapshotOf(
    state,
    snapshotOn(state.quotes, date, need).snapshot,
  ).snapshot;
  return {
    date: quoted.date,
    fx: quoted.fx,
    prices: { ...lastTradePrices(ledgers, date), ...quoted.prices },
  };
}

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
// values it on a day no feed or manual price covers: that day's purchases,
// sales and yields averaged by their units, so how they split across holdings
// or which was recorded first does not matter; in the currency most of them
// traded in. An opening balance's or an adjustment's price is a cost, not
// what a unit was worth.
function lastTradePrices(
  ledgers: readonly Pick<HoldingLedger, "row" | "movements">[],
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
        (movement.kind !== "purchase" &&
          movement.kind !== "sale" &&
          movement.kind !== "yield") ||
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

// The day closes start from: the first movement's, else today.
const firstDay = (
  ledgers: readonly { movements: readonly Movement[] }[],
  today: string,
): string =>
  ledgers
    .map((ledger) => ledger.movements[0]!.date)
    .sort()
    .at(0) ?? today;

// Every month's close in `unit`, oldest first, from the month of the first
// movement to the one in progress.
export function closesOf(
  state: ClosesState,
  unit: Denominator,
): { closes: MonthClose[]; worths: ReadonlyMap<string, string> } {
  const ledgers = ledgersOf(state, unit);
  const first = firstDay(ledgers, state.today);
  const need = closesNeed(state);
  const snapshotAt = (date: string): QuoteSnapshot =>
    pricedAt(state, ledgers, date, need);
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
  // on every past day, in its own unit, as cash does.
  const valueAt = (date: string) => {
    const held = valued(holdingsAt(state, ledgers, date), date);
    const owed = valueLiabilities(debtsToday(state), held.snapshot, {
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
  return { closes, worths };
}

// A month's close and its movements, newest first.
export function monthDetail(
  state: ClosesState,
  unit: Denominator,
  period: string,
  { closes, worths } = closesOf(state, unit),
): MonthDetail | null {
  const close = closes.find((each) => each.period === period);
  if (!close) return null;
  // Units that came in already held or left without a trade show at what
  // they were worth that day, as the close counts them.
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
      const worth = worths.get(movement.id);
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

export function pricedToday(state: ClosesState): QuoteSnapshot {
  const ledgers = allRows(state).map((row) => ({
    row,
    movements: state.movements.get(row.id) ?? [],
  }));
  return pricedAt(state, ledgers, state.today, closesNeed(state));
}
