import {
  compareExact,
  DECIMAL_SCALE_DIGITS,
  type Exact,
  exactOf,
  minus,
  over,
  plus,
  roundedTo,
  splitExact,
  stored,
  times,
  ZERO,
} from "@plant/shared";
import type { QuoteSnapshot } from "../quotes/contract/quote";
import { type ReferenceDollar, express } from "../valuation/denominator";
import type { Denominator } from "../valuation/denominators";
import {
  isIncome,
  isTrade,
  isYield,
  type Movement,
  takesUnits,
} from "./movement";
import { compareInReplay } from "./order";

// A position's figures, rounded to the stored precision between movements.
const kept = (x: Exact): Exact => roundedTo(x, DECIMAL_SCALE_DIGITS);

// A holding's position in one unit after a movement. Money is in the view's
// unit, each movement converted at its own date's rates; it is null when a
// movement's money could not be expressed in that unit (a historic BTC price,
// say). Cost is what the units still held were bought for: every outflow
// takes the oldest units first, at their own cost (FIFO). Charges are kept
// apart from it, income is what dividends and coupons paid and what yields
// earned or lost, and realized is what sales made and what the units a yield
// took out had gained since bought.
export type PositionMoney = {
  cost: string;
  charges: string;
  income: string;
  realized: string;
};
export type Position = { quantity: string; money: PositionMoney | null };

// What one sale made, in the view's unit: gross is quantity times price, cost
// what the oldest units sold were bought for, and result is gross less charges
// and cost.
export type SaleResult = {
  gross: string;
  charges: string;
  cost: string;
  result: string;
};

export type LedgerStep = {
  id: string;
  position: Position;
  // Only on a sale; null when it could not be expressed in the view's unit.
  sale?: SaleResult | null;
};

export const EMPTY_POSITION: Position = {
  quantity: "0",
  money: { cost: "0", charges: "0", income: "0", realized: "0" },
};

// A replay that met a quantity it cannot hold. Admission refuses such a list
// first, so this means a caller skipped it. The message is only the code.
export class PositionError extends Error {
  constructor(readonly code: "oversold") {
    super(code);
    this.name = "PositionError";
  }
}

type Money = { cost: Exact; charges: Exact; income: Exact; realized: Exact };

const moneyText = (money: Money): PositionMoney => ({
  cost: stored(money.cost),
  charges: stored(money.charges),
  income: stored(money.income),
  realized: stored(money.realized),
});

// The sum of a movement's charges, in its currency.
export const chargesOf = (movement: Movement): Exact =>
  plus(...movement.charges.map((charge) => exactOf(charge.amount)));

// How many of the view's unit one unit of the movement's currency was worth on
// its date, from the rates it carries.
function factorOf(
  movement: Movement,
  view: Denominator,
  referenceDollar: ReferenceDollar,
): Exact | null {
  const snapshot: QuoteSnapshot = {
    date: movement.date,
    fx: movement.rates,
    prices: {},
  };
  const one = express(
    { amount: { n: 1n, d: 1n }, currency: movement.currency },
    movement.date,
    view,
    snapshot,
    referenceDollar,
  );
  return "missing" in one ? null : one.value.amount;
}

// What one acquisition left open: units bought together, in the order the
// replay met them (`seq`), at their cost. The cost is null in a view where
// the holding's cost is unknown; the lot is kept so every view sells the same
// units.
type Lot = { seq: number; quantity: Exact; cost: Exact | null };

// A holding's state during one replay, changed in place. Its open lots are
// `lots` from `head` on, oldest first; while money is known, every open lot's
// cost is known.
type Held = { quantity: Exact; money: Money | null; lots: Lot[]; head: number };

const emptyHeld = (): Held => ({
  quantity: ZERO,
  money: { cost: ZERO, charges: ZERO, income: ZERO, realized: ZERO },
  lots: [],
  head: 0,
});

// Takes `moved` units off the oldest open lots, splitting the last one taken
// when it holds more. Their cost is null where the holding's is unknown.
function take(held: Held, moved: Exact): { lots: Lot[]; cost: Exact | null } {
  const known = held.money !== null;
  const taken: Lot[] = [];
  let left = moved;
  let cost = ZERO;
  while (left.n > 0n) {
    const lot = held.lots[held.head];
    if (!lot) throw new PositionError("oversold");
    if (compareExact(lot.quantity, left) <= 0) {
      taken.push(known ? lot : { ...lot, cost: null });
      if (known) cost = plus(cost, lot.cost!);
      left = minus(left, lot.quantity);
      held.head += 1;
    } else {
      const rest = minus(lot.quantity, left);
      const [outCost, restCost] = known
        ? splitExact(lot.cost!, [left, rest])
        : [null, null];
      taken.push({ seq: lot.seq, quantity: left, cost: outCost ?? null });
      held.lots[held.head] = {
        seq: lot.seq,
        quantity: rest,
        cost: restCost ?? null,
      };
      if (outCost) cost = plus(cost, outCost);
      left = ZERO;
    }
  }
  return { lots: taken, cost: known ? cost : null };
}

// Adds lots to the open ones, keeping them oldest first; on an equal `seq`
// (two parts of one lot together again) the one already held goes first.
function receive(held: Held, arriving: readonly Lot[]): void {
  const newest = held.head < held.lots.length ? held.lots.at(-1) : undefined;
  if (!newest || arriving[0]!.seq > newest.seq) {
    held.lots.push(...arriving);
    return;
  }
  const open = held.lots.slice(held.head);
  const merged: Lot[] = [];
  let i = 0;
  let j = 0;
  while (i < open.length || j < arriving.length) {
    if (
      j === arriving.length ||
      (i < open.length && open[i]!.seq <= arriving[j]!.seq)
    ) {
      merged.push(open[i++]!);
    } else {
      merged.push(arriving[j++]!);
    }
  }
  held.lots = merged;
  held.head = 0;
}

// The lots a transfer's units arrive with: the ones they left with (or one
// lot, when the side they left is not in this replay), at the cost the user
// set when there is one, spread by quantity, so that cost is what the units
// carry; at the cost they left with otherwise. Each transfer arrives once.
function arrivingLots(
  movement: Movement,
  seq: number,
  moved: Exact,
  typed: Exact | null,
  carried: Map<string, Lot[]>,
): Lot[] {
  const left = carried.get(movement.operation_id) ?? [
    { seq, quantity: moved, cost: null },
  ];
  carried.delete(movement.operation_id);
  if (typed === null) return left;
  const costs = splitExact(
    typed,
    left.map((lot) => lot.quantity),
  );
  return left.map((lot, index) => ({ ...lot, cost: costs[index]! }));
}

// One movement applied to its holding, in place. `seq` orders the lots it
// opens; `carried` holds the lots each transfer's units left with, by
// operation, so the side they arrive in can take them.
function stepOf(
  held: Held,
  movement: Movement,
  seq: number,
  view: Denominator,
  referenceDollar: ReferenceDollar,
  carried: Map<string, Lot[]>,
): LedgerStep {
  const factor = held.money && factorOf(movement, view, referenceDollar);
  if (!factor) held.money = null;
  const money = held.money;
  const inView = (amount: Exact) => times(amount, factor ?? ZERO);
  const charges = inView(chargesOf(movement));
  let sale: SaleResult | null | undefined;
  if (isTrade(movement)) {
    const moved = exactOf(movement.quantity);
    const isSale = movement.kind === "sale";
    if (takesUnits(movement)) {
      if (compareExact(moved, held.quantity) > 0) {
        throw new PositionError("oversold");
      }
      const { lots, cost } = take(held, moved);
      if (movement.kind === "transfer") {
        carried.set(movement.operation_id, lots);
      }
      if (money && cost) {
        // An adjustment or transfer out takes its cost and makes no result.
        // A yield out loses the units' value that day, and realizes what they
        // had gained over their cost.
        const value =
          movement.price === null
            ? ZERO
            : times(inView(exactOf(movement.price)), moved);
        const result = isSale
          ? minus(minus(value, charges), cost)
          : isYield(movement)
            ? minus(value, cost)
            : ZERO;
        if (isSale) {
          sale = {
            gross: stored(value),
            charges: stored(charges),
            cost: stored(cost),
            result: stored(result),
          };
        }
        held.money = {
          cost: kept(minus(money.cost, cost)),
          charges: kept(plus(money.charges, charges)),
          income: isYield(movement)
            ? kept(minus(money.income, value))
            : money.income,
          realized: kept(plus(money.realized, result)),
        };
      } else if (isSale) {
        sale = null;
      }
      held.quantity = kept(minus(held.quantity, moved));
    } else {
      const lots =
        movement.kind === "transfer"
          ? arrivingLots(
              movement,
              seq,
              moved,
              money && movement.price !== null
                ? kept(times(inView(exactOf(movement.price)), moved))
                : null,
              carried,
            )
          : [
              {
                seq,
                quantity: moved,
                cost: money
                  ? kept(times(inView(exactOf(movement.price)), moved))
                  : null,
              },
            ];
      if (money) {
        const costs = lots.flatMap((lot) => (lot.cost ? [lot.cost] : []));
        if (costs.length < lots.length) {
          held.money = null;
        } else {
          let cost = ZERO;
          for (const each of costs) cost = plus(cost, each);
          held.money = {
            ...money,
            cost: plus(money.cost, cost),
            charges: kept(plus(money.charges, charges)),
            // A yield's units came in as what they earned.
            income: isYield(movement) ? plus(money.income, cost) : money.income,
          };
        }
      }
      receive(held, lots);
      held.quantity = kept(plus(held.quantity, moved));
    }
  } else if (money && isIncome(movement.kind)) {
    held.money = {
      ...money,
      income: kept(plus(money.income, inView(exactOf(movement.amount)))),
      charges: kept(plus(money.charges, charges)),
    };
  }
  return {
    id: movement.id,
    position: {
      quantity: stored(held.quantity),
      money: held.money && moneyText(held.money),
    },
    ...(sale !== undefined && { sale }),
  };
}

// Each holding's steps, oldest first, for the movements of holdings that move
// units between each other (one account's portfolios of one instrument). The
// state is rounded to DECIMAL_SCALE_DIGITS between movements and exact within
// one. A transfer's arriving side carries the lots its units left with, so a
// holding's steps can only be replayed with the holdings it transfers with.
export function replayHoldings(
  movements: readonly Movement[],
  view: Denominator,
  referenceDollar: ReferenceDollar,
): Map<string, LedgerStep[]> {
  const steps = new Map<string, LedgerStep[]>();
  const held = new Map<string, Held>();
  const carried = new Map<string, Lot[]>();
  for (const [seq, movement] of [...movements]
    .sort(compareInReplay)
    .entries()) {
    let own = held.get(movement.holding_id);
    if (!own) {
      own = emptyHeld();
      held.set(movement.holding_id, own);
    }
    const step = stepOf(own, movement, seq, view, referenceDollar, carried);
    const list = steps.get(movement.holding_id);
    if (list) list.push(step);
    else steps.set(movement.holding_id, [step]);
  }
  return steps;
}

// One holding's steps, oldest first, for movements given in order.
export function replay(
  movements: readonly Movement[],
  view: Denominator,
  referenceDollar: ReferenceDollar,
): LedgerStep[] {
  const held = emptyHeld();
  const carried = new Map<string, Lot[]>();
  return movements.map((movement, seq) =>
    stepOf(held, movement, seq, view, referenceDollar, carried),
  );
}

// The position after the last step.
export const positionOf = (steps: readonly LedgerStep[]): Position =>
  steps.at(-1)?.position ?? EMPTY_POSITION;

// What units bought for `cost` would gain or lose at `value` (both in one
// unit): the amount over cost, and that as a share of cost (null when cost
// is 0).
export function unrealized(
  cost: string,
  value: string,
): { amount: string; share: string | null } {
  const paid = exactOf(cost);
  const amount = minus(exactOf(value), paid);
  return {
    amount: stored(amount),
    share: compareExact(paid, ZERO) === 0 ? null : stored(over(amount, paid)),
  };
}
