import { type Denominator, isDenominator } from "@plant/core";

import type { KeysetParams } from "@/lib/supabase/keyset";

import { holdingName } from "./holding-name";
import { ASSET_CLASS_LABELS, type AssetClass } from "./messages";
import type { HoldingRow } from "./read";

// Which holdings the assets page shows: one portfolio or all, one class or
// all, and those whose name, ticker or account contain the search.
export type AssetsFilter = {
  portfolioId: string | null;
  assetClass: AssetClass | null;
  search: string;
};

export const SEARCH_MAX_LENGTH = 60;

const isAssetClass = (value: unknown): value is AssetClass =>
  typeof value === "string" && Object.hasOwn(ASSET_CLASS_LABELS, value);

// Case and accents ignored: "credito" finds "Crédito".
const folded = (text: string): string =>
  text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

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
  { portfolioId, assetClass, search }: AssetsFilter,
  instrumentNames: ReadonlyMap<string, string>,
): boolean {
  if (portfolioId !== null && row.portfolio.id !== portfolioId) return false;
  if (assetClass !== null && row.holding.asset_class !== assetClass) {
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
// them, and the portfolios they are in.
export const TABS = {
  tenencias: "Tenencias",
  cuentas: "Cuentas",
  carteras: "Carteras",
} as const;
export type AssetsTab = keyof typeof TABS;
export const DEFAULT_TAB: AssetsTab = "tenencias";

const isTab = (value: unknown): value is AssetsTab =>
  typeof value === "string" && Object.hasOwn(TABS, value);

// The tab a `vista` param names, or the default.
export const tabOf = (raw: unknown): AssetsTab =>
  isTab(raw) ? raw : DEFAULT_TAB;

// The params the assets page reads.
export type AssetsParam = "moneda" | "cartera" | "tipo" | "buscar" | "vista";

// What the page's params ask for. An invalid value falls back to the default
// and is flagged, so the page can log it: a unit outside DENOMINATORS, a
// portfolio the user does not have active, an unknown class or tab, or a
// search that is not one string of at most SEARCH_MAX_LENGTH characters once
// trimmed.
export function parseAssetsParams(
  params: KeysetParams,
  portfolioIds: readonly string[],
): {
  unit: Denominator | null;
  tab: AssetsTab;
  filter: AssetsFilter;
  invalid: Record<"unit" | "portfolio" | "class" | "search" | "tab", boolean>;
} {
  const { moneda, cartera, tipo, buscar, vista } = params;
  const search = parseSearch(buscar);
  const portfolioId =
    typeof cartera === "string" && portfolioIds.includes(cartera)
      ? cartera
      : null;
  return {
    unit: isDenominator(moneda) ? moneda : null,
    tab: tabOf(vista),
    filter: {
      portfolioId,
      assetClass: isAssetClass(tipo) ? tipo : null,
      search: search ?? "",
    },
    invalid: {
      unit: moneda !== undefined && !isDenominator(moneda),
      portfolio: cartera !== undefined && portfolioId === null,
      class: tipo !== undefined && !isAssetClass(tipo),
      search: search === null,
      tab: vista !== undefined && !isTab(vista),
    },
  };
}
