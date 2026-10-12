import {
  type CashFlow,
  type Position,
  type Returns,
  returnsOf,
} from "@plant/core";
import { sumOrNull } from "@plant/shared";

import { type GainLoss, gainOf } from "./cost-totals";
import type { HoldingRow } from "./read";

// One holding of an instrument: where it is, whether it was sold to zero, its
// position and its value in the page's unit (null without a quote).
export type InstrumentHolding = {
  row: HoldingRow;
  closed: boolean;
  position: Position;
  value: string | null;
};

// An instrument across every account and portfolio, in the page's unit. Each
// money figure is null when a holding's is unknown in the unit.
export type InstrumentSummary = {
  quantity: string;
  value: string | null;
  cost: string | null;
  // What the units still held would gain or lose sold today.
  unrealized: GainLoss | null;
  // What sales made, dividends and coupons paid, and every charge.
  realized: string | null;
  income: string | null;
  charges: string | null;
  // Everything paid in and out, the units held valued today.
  returns: Returns | null;
};

export function instrumentSummary(
  holdings: readonly InstrumentHolding[],
  flows: readonly CashFlow[] | null,
  today: string,
): InstrumentSummary {
  const open = holdings.filter((each) => !each.closed);
  const money = holdings.map((each) => each.position.money);
  const pick = (key: "realized" | "income" | "charges") =>
    sumOrNull(money.map((each) => each?.[key] ?? null));
  const value = sumOrNull(open.map((each) => each.value));
  const cost = sumOrNull(open.map((each) => each.position.money?.cost ?? null));
  return {
    quantity: sumOrNull(open.map((each) => each.position.quantity)) ?? "0",
    value,
    cost,
    unrealized: cost === null || value === null ? null : gainOf(cost, value),
    realized: pick("realized"),
    income: pick("income"),
    charges: pick("charges"),
    returns:
      flows === null || value === null
        ? null
        : returnsOf(
            [...flows].sort((a, b) => a.date.localeCompare(b.date)),
            { date: today, value },
          ),
  };
}
