import {
  compareExact,
  daysBetween,
  type Exact,
  exactOf,
  minus,
  negated,
  over,
  plus,
  stored,
  ZERO,
} from "@plant/shared";

import { isIncome, isYield, type Movement, takesUnits } from "./movement";
import type { LedgerStep } from "./replay";

// Money between the holder and a holding on a date, in the view's unit:
// negative is paid in (a purchase or an adjustment in, at its cost, with its
// charges), positive paid out (a sale less its charges, an adjustment out at
// the cost it takes, an income less its withholding). Its kind says which,
// and `charges` what of it went to commissions, fees and taxes. A yield is
// what the holding earned (positive) or lost (negative) in its own units,
// valued that day: a return, never money paid in or out.
export type CashFlow = {
  date: string;
  amount: string;
  kind: "buy" | "sell" | "income" | "yield";
  charges: string;
};

// Each movement's cash flow, from the replay of the same movements; null when
// a step could not be expressed in the view's unit. Units an adjustment brings
// in are paid in at their cost, and units it takes out are paid out at
// theirs, as the replay counts them. A transfer moves units within the
// account, so its flow is zero; a yield's is the income it moved.
export function cashFlowsOf(
  movements: readonly Movement[],
  steps: readonly LedgerStep[],
): CashFlow[] | null {
  const flows: CashFlow[] = [];
  let before = { cost: ZERO, charges: ZERO, income: ZERO };
  for (const [index, movement] of movements.entries()) {
    const step = steps[index];
    const money = step?.position.money;
    if (!step || !money) return null;
    const now = {
      cost: exactOf(money.cost),
      charges: exactOf(money.charges),
      income: exactOf(money.income),
    };
    const charges = minus(now.charges, before.charges);
    let amount: Exact;
    let kind: CashFlow["kind"] = "buy";
    if (movement.kind === "transfer") {
      if (takesUnits(movement)) kind = "sell";
      amount = ZERO;
    } else if (movement.kind === "sale") {
      kind = "sell";
      if (!step.sale) return null;
      amount = minus(exactOf(step.sale.gross), exactOf(step.sale.charges));
    } else if (isIncome(movement.kind)) {
      kind = "income";
      amount = minus(minus(now.income, before.income), charges);
    } else if (isYield(movement)) {
      kind = "yield";
      amount = minus(now.income, before.income);
    } else {
      if (takesUnits(movement)) kind = "sell";
      amount = negated(plus(minus(now.cost, before.cost), charges));
    }
    flows.push({
      date: movement.date,
      amount: stored(amount),
      kind,
      charges: stored(charges),
    });
    before = now;
  }
  return flows;
}

// What a holding's cash flows made, valued at `value` on `date`: what was paid
// in and out, the result (out plus value less in), the result as a share of
// what was paid in, and the yearly rate that makes the flows and the value
// worth nothing today (the money-weighted return). A yield is in the value,
// not paid in or out. The yearly rate is null for flows under a year old,
// where a year's rate overstates a short run, or when no rate solves them.
export type Returns = {
  paidIn: string;
  paidOut: string;
  result: string;
  share: string | null;
  annual: string | null;
};

const YEAR_DAYS = 365;

export function returnsOf(
  all: readonly CashFlow[],
  { date, value }: { date: string; value: string },
): Returns {
  const flows = all.filter((flow) => flow.kind !== "yield");
  let paidIn = ZERO;
  let paidOut = ZERO;
  for (const flow of flows) {
    const amount = exactOf(flow.amount);
    if (compareExact(amount, ZERO) < 0) paidIn = plus(paidIn, negated(amount));
    else paidOut = plus(paidOut, amount);
  }
  const result = minus(plus(paidOut, exactOf(value)), paidIn);
  const first = flows[0]?.date;
  return {
    paidIn: stored(paidIn),
    paidOut: stored(paidOut),
    result: stored(result),
    share:
      compareExact(paidIn, ZERO) === 0 ? null : stored(over(result, paidIn)),
    annual:
      first !== undefined && daysBetween(first, date) >= YEAR_DAYS
        ? yearlyRate(
            [...flows, { date, amount: value, kind: "sell", charges: "0" }],
            date,
          )
        : null,
  };
}

// The rate r where the flows, each discounted by (1 + r) to the power of its
// years before `date`, add up to nothing; found by bisection, to four
// decimals. A rate is a ratio, not money, so it is solved in floating point.
function yearlyRate(flows: readonly CashFlow[], date: string): string | null {
  const points = flows.map((flow) => ({
    years: daysBetween(flow.date, date) / YEAR_DAYS,
    amount: Number(flow.amount),
  }));
  const worth = (rate: number) =>
    points.reduce(
      (total, { years, amount }) => total + amount * (1 + rate) ** years,
      0,
    );
  let low = -0.9999;
  let high = 100;
  if (Math.sign(worth(low)) === Math.sign(worth(high))) return null;
  for (let step = 0; step < 200 && high - low > 1e-7; step += 1) {
    const middle = (low + high) / 2;
    if (Math.sign(worth(middle)) === Math.sign(worth(low))) low = middle;
    else high = middle;
  }
  return ((low + high) / 2).toFixed(4);
}
