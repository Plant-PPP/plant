import {
  type InstrumentType,
  INSTRUMENT_TYPES,
  isIncome,
  isYield,
  takesUnits,
  valueHolding,
} from "@plant/core";
import {
  type Currency,
  type Exact,
  exactOf,
  plus,
  stored,
  sumOrNull,
  times,
} from "@plant/shared";

import { type AssetKey, assetKey } from "@/lib/holdings/assets-rows";
import { classOf, type HoldingClass } from "@/lib/holdings/classes";
import { holdingName, instrumentNames } from "@/lib/holdings/holding-name";
import type { HoldingRow } from "@/lib/holdings/read";
import { accountInTaxReport } from "@/lib/holdings/tax-report";
import {
  allRows,
  moneyChange,
  positionBefore,
  stepsOf,
} from "@/lib/ledger/ledger";
import { type ClosesState, heldOn } from "@/lib/summary/compute";

// The Banco Nación buying rate a foreign-currency asset is valued at, with
// the day it is from: the dollar's for dollars, the euro's for euros.
export type OfficialBuy = { buy: string; date: string };

// One asset as the year ended: an instrument across every holding of it the
// report counts, or any other holding on its own; its amount in the currency
// it is held in and in pesos, null when unknown.
export type WealthLine = {
  key: AssetKey;
  name: string;
  holdingClass: HoldingClass;
  currency: Currency | null;
  amount: string | null;
  ars: string | null;
  exempt: boolean;
};

export type GainsKind =
  `sale_${InstrumentType}` | "dividend" | "coupon" | "yield";

// One kind of result over the year, in pesos: null when one of its movements
// could not be expressed in pesos.
export type GainsGroup = {
  kind: GainsKind;
  count: number;
  amount: string | null;
};

// A year's estimate: what was held at its end (today for the year in
// progress), and what sales and income gave over it.
export type TaxReport = {
  year: string;
  date: string;
  provisional: boolean;
  officialBuy: OfficialBuy | null;
  euroBuy: OfficialBuy | null;
  wealth: {
    lines: WealthLine[];
    taxable: string;
    exempt: string;
    complete: boolean;
  };
  gains: { groups: GainsGroup[]; total: string; complete: boolean };
  // The assets held that day the user left out of the report.
  leftOut: number;
};

export const GAINS_KINDS: readonly GainsKind[] = [
  ...INSTRUMENT_TYPES.map((type) => `sale_${type}` as const),
  "dividend",
  "coupon",
  "yield",
];

// The day a year is valued at: its last, or today while it runs.
export const taxDate = (year: string, today: string): string =>
  year === today.slice(0, 4) ? today : `${year}-12-31`;

// Every year from the first movement's to today's, newest first.
export function taxYears(state: ClosesState): string[] {
  const now = Number(state.today.slice(0, 4));
  let first = now;
  for (const movements of state.movements.values()) {
    const year = Number(movements[0]?.date.slice(0, 4) ?? now);
    if (year < first) first = year;
  }
  const years: string[] = [];
  for (let year = now; year >= first; year -= 1) years.push(String(year));
  return years;
}

// The year the page opens on: the last one that ended, which is the one
// declared, when there is data for it; else the one in progress.
export const defaultTaxYear = (years: readonly string[], today: string) => {
  const last = String(Number(today.slice(0, 4)) - 1);
  return years.includes(last) ? last : years[0]!;
};

// The year ?year= names, when it is one the page offers, else the default.
export const taxYearOf = (
  param: string | string[] | undefined,
  years: readonly string[],
  today: string,
): string =>
  typeof param === "string" && years.includes(param)
    ? param
    : defaultTaxYear(years, today);

// Whether a holding is out of the report: its account is, or the user left
// its asset out.
export const leftOutOf =
  (state: ClosesState, excluded: ReadonlySet<AssetKey>) =>
  (row: HoldingRow): boolean =>
    !accountInTaxReport(
      [...state.accounts, ...state.archivedAccounts],
      row.account.id,
    ) || excluded.has(assetKey(row.holding));

// Exempt, simplified: a plazo fijo (a deposit in an Argentine bank) and
// bonds (government bonds and corporate notes).
const isExempt = (
  row: HoldingRow,
  isPlazoFijo: (row: HoldingRow) => boolean,
): boolean =>
  row.instrumentType === "bond" ||
  (row.holding.asset_class === "fixed_term" && isPlazoFijo(row));

const sum = (values: readonly Exact[]): string => stored(plus(...values));

function wealthOf(
  state: ClosesState,
  date: string,
  buys: Record<Exclude<Currency, "ARS">, OfficialBuy | null>,
  leftOut: (row: HoldingRow) => boolean,
  isPlazoFijo: (row: HoldingRow) => boolean,
) {
  const { rows, snapshot } = heldOn(state, date);
  const names = instrumentNames(state.instruments);
  const lines = new Map<AssetKey, WealthLine>();
  const out = new Set<AssetKey>();
  for (const row of rows) {
    const key = assetKey(row.holding);
    const value = valueHolding(row.holding, snapshot);
    if ("state" in value && value.state === "not_started") continue;
    if (leftOut(row)) {
      out.add(key);
      continue;
    }
    const money = "missing" in value ? null : value.money;
    const buy =
      money === null || money.currency === "ARS" ? null : buys[money.currency];
    const ars =
      money === null
        ? null
        : money.currency === "ARS"
          ? money.amount
          : buy === null
            ? null
            : times(money.amount, exactOf(buy.buy));
    const kept = lines.get(key);
    if (kept) {
      kept.amount =
        kept.amount === null || money === null
          ? null
          : sum([exactOf(kept.amount), money.amount]);
      kept.ars =
        kept.ars === null || ars === null
          ? null
          : sum([exactOf(kept.ars), ars]);
      kept.currency ??= money?.currency ?? null;
      continue;
    }
    lines.set(key, {
      key,
      name: holdingName(row.holding, names),
      holdingClass: classOf(row),
      currency: money?.currency ?? null,
      amount: money === null ? null : stored(money.amount),
      ars: ars === null ? null : stored(ars),
      exempt: isExempt(row, isPlazoFijo),
    });
  }
  const list = [...lines.values()];
  list.sort((a, b) => a.name.localeCompare(b.name, "es"));
  const known = (exempt: boolean) =>
    list.flatMap((line) =>
      line.exempt === exempt && line.ars !== null ? [exactOf(line.ars)] : [],
    );
  // An asset left out of the report that is also counted elsewhere (an
  // instrument held in an account the report keeps) is counted, not left
  // out.
  const leftOutCount = [...out].filter((key) => !lines.has(key)).length;
  return {
    wealth: {
      lines: list,
      taxable: sum(known(false)),
      exempt: sum(known(true)),
      // Cash on the day counts what debt payments took after it, so a read
      // that cut debts, their events or holdings leaves it unsure.
      complete: !state.partial && list.every((line) => line.ars !== null),
    },
    leftOut: leftOutCount,
  };
}

function gainsOf(
  state: ClosesState,
  { from, to }: { from: string; to: string },
  leftOut: (row: HoldingRow) => boolean,
) {
  const byKind = new Map<
    GainsKind,
    { operations: Set<string>; amounts: (string | null)[] }
  >();
  for (const row of allRows(state)) {
    if (row.holding.asset_class !== "instrument" || leftOut(row)) continue;
    const movements = state.movements.get(row.id) ?? [];
    const steps = stepsOf(state, row.id, "ars");
    movements.forEach((movement, index) => {
      if (movement.date < from || movement.date > to) return;
      let kind: GainsKind;
      let amount: string | null;
      if (movement.kind === "sale") {
        if (row.instrumentType === null) return;
        kind = `sale_${row.instrumentType}`;
        amount = steps[index]?.sale?.result ?? null;
      } else if (isIncome(movement.kind) || isYield(movement)) {
        kind = movement.kind as "dividend" | "coupon" | "yield";
        const step = steps[index];
        const before = positionBefore(steps, index);
        // Units a yield takes out lose their value that day and realize what
        // they had gained over their cost, as the ledger books it.
        amount = !step
          ? null
          : isYield(movement) && takesUnits(movement)
            ? sumOrNull([
                moneyChange(before, step, "income"),
                moneyChange(before, step, "realized"),
              ])
            : moneyChange(before, step, "income");
      } else return;
      const group = byKind.get(kind) ?? { operations: new Set(), amounts: [] };
      group.operations.add(movement.operation_id);
      group.amounts.push(amount);
      byKind.set(kind, group);
    });
  }
  const groups = GAINS_KINDS.flatMap((kind): GainsGroup[] => {
    const group = byKind.get(kind);
    return group
      ? [
          {
            kind,
            count: group.operations.size,
            amount: sumOrNull(group.amounts),
          },
        ]
      : [];
  });
  return {
    groups,
    total: sum(
      groups.flatMap((group) =>
        group.amount === null ? [] : [exactOf(group.amount)],
      ),
    ),
    complete: groups.every((group) => group.amount !== null),
  };
}

// A year's estimate for Bienes Personales and Ganancias, in pesos. Assets are
// valued as the closes value them on the year's last day, one in dollars at
// `officialBuy` and one in euros at `euroBuy`; results are the ledger's in
// pesos, each movement at its own day's rates, and sales take the oldest
// units first.
export function taxReport(
  state: ClosesState,
  {
    year,
    officialBuy,
    euroBuy,
    leftOut,
    isPlazoFijo,
  }: {
    year: string;
    officialBuy: OfficialBuy | null;
    euroBuy: OfficialBuy | null;
    leftOut: (row: HoldingRow) => boolean;
    isPlazoFijo: (row: HoldingRow) => boolean;
  },
): TaxReport {
  const date = taxDate(year, state.today);
  const { wealth, leftOut: leftOutCount } = wealthOf(
    state,
    date,
    { USD: officialBuy, EUR: euroBuy },
    leftOut,
    isPlazoFijo,
  );
  return {
    year,
    date,
    provisional: date === state.today,
    officialBuy,
    euroBuy,
    wealth,
    gains: gainsOf(state, { from: `${year}-01-01`, to: date }, leftOut),
    leftOut: leftOutCount,
  };
}
