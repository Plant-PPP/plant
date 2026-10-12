import {
  compareExact,
  DECIMAL_SCALE_DIGITS,
  type Exact,
  exactOf,
  minus,
  over,
  plus,
  roundedTo,
  stored,
  times,
  ZERO,
} from "@plant/shared";
import type { QuoteSnapshot } from "../quotes/contract/quote";
import { type ReferenceDollar, express } from "../valuation/denominator";
import type { Denominator } from "../valuation/denominators";
import { isIncome, isTrade, type Movement, takesUnits } from "./movement";
import { compareInReplay } from "./order";

// A position's figures, rounded to the stored precision between movements.
const kept = (x: Exact): Exact => roundedTo(x, DECIMAL_SCALE_DIGITS);

// A holding's position in one unit after a movement. Money is in the view's
// unit, each movement converted at its own date's rates; it is null when a
// movement's money could not be expressed in that unit (a historic BTC price,
// say). Cost is what the units still held were bought for; charges are kept
// apart from it, income is what dividends and coupons paid, and realized is
// what sales made.
export type PositionMoney = {
  cost: string;
  charges: string;
  income: string;
  realized: string;
};
export type Position = { quantity: string; money: PositionMoney | null };

// What one sale made, in the view's unit: gross is quantity times price, cost
// the share of the average cost the units sold carried, and result is gross
// less charges and cost.
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

const moneyOf = (money: PositionMoney): Money => ({
  cost: exactOf(money.cost),
  charges: exactOf(money.charges),
  income: exactOf(money.income),
  realized: exactOf(money.realized),
});

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

type Held = { quantity: Exact; money: Money | null };

const heldOf = (position: Position): Held => ({
  quantity: exactOf(position.quantity),
  money: position.money && moneyOf(position.money),
});

// One movement applied to what its holding held. `carried` holds the cost
// each transfer's units left with, by operation, so the side they arrive in
// can take it.
function stepOf(
  held: Held,
  movement: Movement,
  view: Denominator,
  referenceDollar: ReferenceDollar,
  carried: Map<string, Exact | null>,
): { held: Held; step: LedgerStep } {
  let { quantity, money } = held;
  const factor = money && factorOf(movement, view, referenceDollar);
  if (!factor) money = null;
  const inView = (amount: Exact) => times(amount, factor ?? ZERO);
  const charges = inView(chargesOf(movement));
  let sale: SaleResult | null | undefined;
  if (isTrade(movement)) {
    const moved = exactOf(movement.quantity);
    const isSale = movement.kind === "sale";
    if (takesUnits(movement)) {
      if (compareExact(moved, quantity) > 0) {
        throw new PositionError("oversold");
      }
      if (money) {
        const cost =
          compareExact(moved, quantity) === 0
            ? money.cost
            : kept(over(times(money.cost, moved), quantity));
        if (movement.kind === "transfer") {
          carried.set(movement.operation_id, cost);
        }
        // An adjustment or transfer out takes its cost and makes no result.
        const value =
          movement.price === null
            ? ZERO
            : times(inView(exactOf(movement.price)), moved);
        const result = isSale ? minus(minus(value, charges), cost) : ZERO;
        if (isSale) {
          sale = {
            gross: stored(value),
            charges: stored(charges),
            cost: stored(cost),
            result: stored(result),
          };
        }
        money = {
          cost: kept(minus(money.cost, cost)),
          charges: kept(plus(money.charges, charges)),
          income: money.income,
          realized: kept(plus(money.realized, result)),
        };
      } else {
        if (movement.kind === "transfer") {
          carried.set(movement.operation_id, null);
        }
        if (isSale) sale = null;
      }
      quantity = kept(minus(quantity, moved));
    } else {
      if (money) {
        const cost =
          movement.price === null
            ? carried.get(movement.operation_id)
            : times(inView(exactOf(movement.price)), moved);
        money =
          cost == null
            ? null
            : {
                ...money,
                cost: kept(plus(money.cost, cost)),
                charges: kept(plus(money.charges, charges)),
              };
      }
      quantity = kept(plus(quantity, moved));
    }
  } else if (money && isIncome(movement.kind)) {
    money = {
      ...money,
      income: kept(plus(money.income, inView(exactOf(movement.amount)))),
      charges: kept(plus(money.charges, charges)),
    };
  }
  return {
    held: { quantity, money },
    step: {
      id: movement.id,
      position: {
        quantity: stored(quantity),
        money: money && moneyText(money),
      },
      ...(sale !== undefined && { sale }),
    },
  };
}

// Each holding's steps, oldest first, for the movements of holdings that move
// units between each other (one account's portfolios of one instrument). The
// state is rounded to DECIMAL_SCALE_DIGITS between movements and exact within
// one. A transfer's arriving side carries the cost its units left with, so a
// holding's steps can only be replayed with the holdings it transfers with.
export function replayHoldings(
  movements: readonly Movement[],
  view: Denominator,
  referenceDollar: ReferenceDollar,
): Map<string, LedgerStep[]> {
  const steps = new Map<string, LedgerStep[]>();
  const held = new Map<string, Held>();
  const carried = new Map<string, Exact | null>();
  for (const movement of [...movements].sort(compareInReplay)) {
    const before = held.get(movement.holding_id) ?? heldOf(EMPTY_POSITION);
    const next = stepOf(before, movement, view, referenceDollar, carried);
    held.set(movement.holding_id, next.held);
    const own = steps.get(movement.holding_id);
    if (own) own.push(next.step);
    else steps.set(movement.holding_id, [next.step]);
  }
  return steps;
}

// One holding's steps, oldest first, from `from` (the position before the
// first of them; empty when they start the holding), for movements given in
// order. Replaying from any stored step gives the same steps as replaying
// from the start, unless the holding receives a transfer, whose cost only
// replayHoldings carries.
export function replay(
  movements: readonly Movement[],
  view: Denominator,
  referenceDollar: ReferenceDollar,
  { from = EMPTY_POSITION }: { from?: Position } = {},
): LedgerStep[] {
  let held = heldOf(from);
  const carried = new Map<string, Exact | null>();
  return movements.map((movement) => {
    const next = stepOf(held, movement, view, referenceDollar, carried);
    held = next.held;
    return next.step;
  });
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
