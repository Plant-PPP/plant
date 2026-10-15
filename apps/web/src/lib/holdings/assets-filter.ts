import { type Denominator, isViewUnit } from "@plant/core";

import type { KeysetParams } from "@/lib/supabase/keyset";

import { folded } from "@/lib/format/text";

import { holdingName } from "./holding-name";
import { classOf, type HoldingClass, isHoldingClass } from "./classes";
import type { HoldingRow } from "./read";

// Which holdings the assets page shows: one portfolio or all, one class or
// all, and those whose name, ticker or account contain the search.
export type AssetsFilter = {
  portfolioId: string | null;
  holdingClass: HoldingClass | null;
  search: string;
};

export const SEARCH_MAX_LENGTH = 60;

// A search the page accepts, or null for one it ignores (and logs).
function parseSearch(raw: unknown): string | null {
  if (raw === undefined) return "";
  if (typeof raw !== "string") return null;
  const search = raw.trim();
  return search.length > SEARCH_MAX_LENGTH ? null : search;
}

// The ticker a holding is listed by: its instrument's symbol, or the currency
// of its cash or fixed term.
export function tickerOf({ holding }: HoldingRow): string | null {
  if (holding.asset_class === "instrument") return holding.instrument_symbol;
  if (holding.asset_class === "cash" || holding.asset_class === "fixed_term") {
    return holding.currency;
  }
  return null;
}

export function matchesFilter(
  row: HoldingRow,
  { portfolioId, holdingClass, search }: AssetsFilter,
  instrumentNames: ReadonlyMap<string, string>,
): boolean {
  if (portfolioId !== null && row.portfolio.id !== portfolioId) return false;
  if (holdingClass !== null && classOf(row) !== holdingClass) {
    return false;
  }
  if (search === "") return true;
  const needle = folded(search);
  return [
    holdingName(row.holding, instrumentNames),
    tickerOf(row) ?? "",
    row.account.institution,
  ].some((text) => folded(text).includes(needle));
}

// The page's tabs, each its own table: the holdings, the accounts that hold
// them, and the portfolios they are in. A page that has movements adds the
// sales.
export const TABS = {
  holdings: "Tenencias",
  accounts: "Cuentas",
  portfolios: "Carteras",
} as const;
export const SALES_TABS = { ...TABS, sales: "Ventas" } as const;
export type AssetsTab = keyof typeof SALES_TABS;
// The tabs one page offers, in order, by their labels.
export type AssetsTabs = Partial<Record<AssetsTab, string>>;
export const DEFAULT_TAB: AssetsTab = "holdings";

const isTab = (value: unknown, tabs: AssetsTabs): value is AssetsTab =>
  typeof value === "string" && Object.hasOwn(tabs, value);

export const tabOf = (raw: unknown, tabs: AssetsTabs): AssetsTab =>
  isTab(raw, tabs) ? raw : DEFAULT_TAB;

// The unit param for a choice: none for the user's reference dollar, which
// the page values in by default.
export const unitParam = (unit: string, reference: Denominator) =>
  unit === reference ? null : unit;

// The params the assets page reads.
export type AssetsParam =
  "unit" | "portfolio" | "class" | "search" | "tab" | "year";

// What the page's params ask for. An invalid value falls back to the default
// and is flagged, so the page can log it: a unit outside VIEW_UNITS, a
// portfolio the user does not have active, an unknown class, a tab the page
// does not offer, a year with no sales, or a search that is not one string of
// at most SEARCH_MAX_LENGTH characters once trimmed. The year defaults to the
// latest with sales, newest first in salesYears.
export function parseAssetsParams(
  params: KeysetParams,
  {
    portfolioIds,
    tabs,
    salesYears,
  }: {
    portfolioIds: readonly string[];
    tabs: AssetsTabs;
    salesYears: readonly string[];
  },
): {
  unit: Denominator | null;
  tab: AssetsTab;
  year: string | null;
  filter: AssetsFilter;
  invalid: Record<AssetsParam, boolean>;
} {
  const {
    unit,
    portfolio,
    class: holdingClass,
    search: rawSearch,
    tab,
    year,
  } = params;
  const search = parseSearch(rawSearch);
  const portfolioId =
    typeof portfolio === "string" && portfolioIds.includes(portfolio)
      ? portfolio
      : null;
  const salesYear =
    typeof year === "string" && salesYears.includes(year) ? year : null;
  return {
    unit: isViewUnit(unit) ? unit : null,
    tab: tabOf(tab, tabs),
    year: salesYear ?? salesYears[0] ?? null,
    filter: {
      portfolioId,
      holdingClass: isHoldingClass(holdingClass) ? holdingClass : null,
      search: search ?? "",
    },
    invalid: {
      unit: unit !== undefined && !isViewUnit(unit),
      portfolio: portfolio !== undefined && portfolioId === null,
      class: holdingClass !== undefined && !isHoldingClass(holdingClass),
      search: search === null,
      tab: tab !== undefined && !isTab(tab, tabs),
      year: year !== undefined && salesYear === null,
    },
  };
}
