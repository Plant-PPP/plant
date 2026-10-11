import {
  compareExact,
  type Exact,
  exactOf,
  over,
  plus,
  roundedTo,
  times,
  toDecimal,
} from "@plant/shared";
import type { QuoteSnapshot } from "../quotes/contract/quote";
import { type ReferenceDollar, express } from "../valuation/denominator";
import type { Denominator } from "../valuation/denominators";
import { isIncome, isTrade, type Movement } from "./movement";

// The digits a position keeps between movements: its stored precision.
const STATE_DIGITS = 8;

const ZERO: Exact = { n: 0n, d: 1n };
const negated = (x: Exact): Exact => ({ n: -x.n, d: x.d });
const minus = (a: Exact, b: Exact): Exact => plus(a, negated(b));
const kept = (x: Exact): Exact => roundedTo(x, STATE_DIGITS);
const text = (x: Exact): string => toDecimal(x, STATE_DIGITS);

// A holding's position in one unit after a movement. Money is in the view's
// unit, each movement converted at its own date's rates; it is null when a
// movement's money could not be expressed in that unit (a historic BTC price,
// say). Cost is what the units still held were bought for; fees and taxes are
// kept apart from it, and income is what dividends and coupons paid.
export type PositionMoney = {
  cost: string;
  fees: string;
  taxes: string;
  income: string;
  realized: string;
};
export type Position = { quantity: string; money: PositionMoney | null };

// What one sale made, in the view's unit: gross is quantity times price, cost
// the share of the average cost the units sold carried, and result is gross
// less fees, taxes and cost.
export type SaleResult = {
  gross: string;
  fees: string;
  taxes: string;
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
  money: { cost: "0", fees: "0", taxes: "0", income: "0", realized: "0" },
};

// A replay that met a quantity it cannot hold. Admission refuses such a list
// first, so this means a caller skipped it. The message is only the code.
export class PositionError extends Error {
  constructor(readonly code: "oversold") {
    super(code);
    this.name = "PositionError";
  }
}

type Money = {
  cost: Exact;
  fees: Exact;
  taxes: Exact;
  income: Exact;
  realized: Exact;
};

const moneyOf = (money: PositionMoney): Money => ({
  cost: exactOf(money.cost),
  fees: exactOf(money.fees),
  taxes: exactOf(money.taxes),
  income: exactOf(money.income),
  realized: exactOf(money.realized),
});

const moneyText = (money: Money): PositionMoney => ({
  cost: text(money.cost),
  fees: text(money.fees),
  taxes: text(money.taxes),
  income: text(money.income),
  realized: text(money.realized),
});

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

// Each movement's step, oldest first, from `from` (the position before the
// first of them; empty when they start the holding). The state is rounded to
// STATE_DIGITS between movements and exact within one, so replaying from any
// stored step gives the same steps as replaying from the start.
export function replay(
  movements: readonly Movement[],
  view: Denominator,
  referenceDollar: ReferenceDollar,
  { from = EMPTY_POSITION }: { from?: Position } = {},
): LedgerStep[] {
  let quantity = exactOf(from.quantity);
  let money: Money | null = from.money && moneyOf(from.money);
  const steps: LedgerStep[] = [];
  for (const movement of movements) {
    const factor = money && factorOf(movement, view, referenceDollar);
    if (!factor) money = null;
    const inView = (amount: string) => times(exactOf(amount), factor ?? ZERO);
    let sale: SaleResult | null | undefined;
    if (isTrade(movement)) {
      const moved = exactOf(movement.quantity);
      if (movement.kind === "sale") {
        if (compareExact(moved, quantity) > 0)
          throw new PositionError("oversold");
        if (money) {
          const cost =
            compareExact(moved, quantity) === 0
              ? money.cost
              : kept(over(times(money.cost, moved), quantity));
          const gross = inView(movement.price);
          const grossTotal = times(gross, moved);
          const fees = inView(movement.fees);
          const taxes = inView(movement.taxes);
          const result = minus(minus(minus(grossTotal, fees), taxes), cost);
          sale = {
            gross: text(grossTotal),
            fees: text(fees),
            taxes: text(taxes),
            cost: text(cost),
            result: text(result),
          };
          money = {
            cost: kept(minus(money.cost, cost)),
            fees: kept(plus(money.fees, fees)),
            taxes: kept(plus(money.taxes, taxes)),
            income: money.income,
            realized: kept(plus(money.realized, result)),
          };
        } else {
          sale = null;
        }
        quantity = kept(minus(quantity, moved));
      } else {
        if (money) {
          money = {
            ...money,
            cost: kept(plus(money.cost, times(inView(movement.price), moved))),
            fees: kept(plus(money.fees, inView(movement.fees))),
            taxes: kept(plus(money.taxes, inView(movement.taxes))),
          };
        }
        quantity = kept(plus(quantity, moved));
      }
    } else if (money && isIncome(movement.kind)) {
      money = {
        ...money,
        income: kept(plus(money.income, inView(movement.amount))),
        fees: kept(plus(money.fees, inView(movement.fees))),
        taxes: kept(plus(money.taxes, inView(movement.taxes))),
      };
    }
    steps.push({
      id: movement.id,
      position: { quantity: text(quantity), money: money && moneyText(money) },
      ...(sale !== undefined && { sale }),
    });
  }
  return steps;
}

// The position after the last step.
export const positionOf = (steps: readonly LedgerStep[]): Position =>
  steps.at(-1)?.position ?? EMPTY_POSITION;

// What the units held would gain or lose at `value` (in the position's unit):
// the amount over cost, and that as a share of cost (null when cost is 0).
export function unrealized(
  position: Position,
  value: string,
): { amount: string; share: string | null } | null {
  if (!position.money) return null;
  const cost = exactOf(position.money.cost);
  const amount = minus(exactOf(value), cost);
  return {
    amount: text(amount),
    share: compareExact(cost, ZERO) === 0 ? null : text(over(amount, cost)),
  };
}
