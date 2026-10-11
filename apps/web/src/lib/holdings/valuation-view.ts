import {
  type Denominator,
  DENOMINATORS,
  type Holding,
  type HoldingsValue,
  type QuoteSnapshot,
  type ReferenceDollar,
  valueHoldings,
} from "@plant/core";
import {
  compareDecimals,
  compareExact,
  exactOf,
  over,
  times,
  toDecimal,
} from "@plant/shared";

import { SMALL_PRICE_DIGITS } from "@/lib/format/amount";

import { classOf, type HoldingClass } from "./classes";
import type { HoldingRow } from "./read";

type HoldingValue = HoldingsValue["items"][number] & {
  // One unit of the instrument or currency, in the page's unit.
  price: string | null;
  // Its share of the total, in percent to one decimal.
  share: string | null;
};

// count is how many holdings it sums and missing how many of them had no
// quote; complete is false when one had none or the list was cut. share is its
// part of the whole, in percent to one decimal, or null when the whole is not
// positive or it values no holding (it has none, or none had a quote).
export type Sum = {
  value: string;
  complete: boolean;
  count: number;
  missing: number;
  share: string | null;
};

// What a holding counts as in the page's summary.
export type HoldingKind = "cash" | "investments" | "other";

const kindOf = (holding: Holding): HoldingKind =>
  holding.asset_class === "cash"
    ? "cash"
    : holding.asset_class === "instrument" ||
        holding.asset_class === "fixed_term"
      ? "investments"
      : "other";

// Whether one unit of the holding has a price: an instrument's quote, or a
// currency's rate.
export const hasUnitPrice = (holding: Holding): boolean =>
  holding.asset_class === "instrument" || holding.asset_class === "cash";

export type Breakdown = Record<HoldingKind | "total", Sum>;

// What the assets page shows, every amount computed by core: each holding's
// value and price; each portfolio's and account's sum, the account's split by
// kind; and the whole split by kind (its total among them) and by class, in
// one unit.
export type HoldingsValuation = {
  values: Record<string, HoldingValue>;
  portfolios: Record<string, Sum>;
  accounts: Record<string, Breakdown>;
  kinds: Breakdown;
  classes: Partial<Record<HoldingClass, Sum>>;
};

// The caller passes the holdings the page shows. Each sum is rounded once from
// its exact amount, so rounded parts need not add up to a rounded whole.
export function holdingsValuation({
  holdings,
  truncated,
  snapshot,
  unit,
  referenceDollar,
}: {
  holdings: readonly (Pick<HoldingRow, "holding" | "instrumentType"> & {
    account: { id: string };
  })[];
  truncated: boolean;
  snapshot: QuoteSnapshot;
  unit: Denominator;
  referenceDollar: ReferenceDollar;
}): HoldingsValuation {
  const options = { denominator: unit, referenceDollar };
  const value = (subset: readonly Holding[]) =>
    valueHoldings(subset, snapshot, options);
  const all = holdings.map((row) => row.holding);
  const byId = new Map(all.map((holding) => [holding.id, holding]));
  const whole = value(all);
  const shareOf = (amount: string | null): string | null =>
    amount === null || compareExact(whole.exactTotal, exactOf("0")) <= 0
      ? null
      : toDecimal(
          times(over(exactOf(amount), whole.exactTotal), exactOf("100")),
          1,
        );
  const sum = (subset: readonly Holding[]): Sum => {
    const valued = value(subset);
    return {
      value: valued.total,
      complete: valued.complete && !truncated,
      count: subset.length,
      missing: valued.missing.length,
      share:
        valued.missing.length === subset.length ? null : shareOf(valued.total),
    };
  };
  const breakdown = (subset: readonly Holding[]): Breakdown => ({
    cash: sum(subset.filter((h) => kindOf(h) === "cash")),
    investments: sum(subset.filter((h) => kindOf(h) === "investments")),
    other: sum(subset.filter((h) => kindOf(h) === "other")),
    total: sum(subset),
  });
  const groupBy = <K extends string>(key: (holding: Holding) => K) => {
    const groups = new Map<K, Holding[]>();
    for (const holding of all) {
      const id = key(holding);
      const group = groups.get(id) ?? [];
      group.push(holding);
      groups.set(id, group);
    }
    return [...groups];
  };
  const accountOf = new Map(
    holdings.map((row) => [row.holding.id, row.account.id]),
  );
  const classById = new Map(
    holdings.map((row) => [row.holding.id, classOf(row)]),
  );

  const priceOf = (holding: Holding): string | null => {
    if (!hasUnitPrice(holding)) return null;
    const one = value([{ ...holding, amount: "1" }]);
    if (!one.complete) return null;
    const small = compareExact(one.exactTotal, exactOf("1")) < 0;
    const price = toDecimal(
      one.exactTotal,
      Math.max(DENOMINATORS[unit].scale, small ? SMALL_PRICE_DIGITS : 0),
    );
    // A price too small for its decimals is unknown here, never zero.
    return compareDecimals(price, "0") === 0 ? null : price;
  };

  return {
    values: Object.fromEntries(
      whole.items.map((item) => {
        const holding = byId.get(item.id);
        return [
          item.id,
          {
            ...item,
            price: holding ? priceOf(holding) : null,
            share: shareOf(item.value),
          },
        ];
      }),
    ),
    portfolios: Object.fromEntries(
      groupBy((h) => h.portfolio_id).map(([id, subset]) => [id, sum(subset)]),
    ),
    accounts: Object.fromEntries(
      groupBy((h) => accountOf.get(h.id) ?? "").map(([id, subset]) => [
        id,
        breakdown(subset),
      ]),
    ),
    kinds: breakdown(all),
    classes: Object.fromEntries(
      groupBy((h) => classById.get(h.id) ?? h.asset_class).map(
        ([id, subset]) => [id, sum(subset)],
      ),
    ),
  };
}
