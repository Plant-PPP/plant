"use client";

import type { Denominator } from "@plant/core";
import { Search } from "lucide-react";
import { useEffect, useId, useState } from "react";

import { Input } from "@/components/ui/input";
import {
  type AssetsFilter,
  type AssetsParam,
  type AssetsTabs,
  SEARCH_MAX_LENGTH,
  parseAssetsParams,
  unitParam,
} from "@/lib/holdings/assets-filter";
import {
  ASSET_CLASSES,
  ASSET_CLASS_LABELS,
  UNIT_LABELS,
} from "@/lib/holdings/messages";
import type { PortfolioRow } from "@/lib/portfolio-setup/read";

import { type AssetsUrl, searchParamValue } from "./assets-url";
import { FilterSelect } from "./filter-select";

const ALL = "all";
const SEARCH_DELAY_MS = 250;

// The search, class, portfolio and unit the page shows, kept in the URL; each
// shows the user's choice at once. They wait while a write runs, as paging
// does; a search typed meanwhile is sent once it ends.
export function AssetsFilters({
  url,
  tabs,
  salesYears = [],
  referenceUnit,
  filter,
  portfolios,
  pending,
}: {
  url: AssetsUrl;
  tabs: AssetsTabs;
  // The years with sales, newest first, for the sales tab's year.
  salesYears?: readonly string[];
  referenceUnit: Denominator;
  filter: AssetsFilter;
  portfolios: PortfolioRow[];
  pending: boolean;
}) {
  const ids = {
    search: useId(),
    kind: useId(),
    portfolio: useId(),
    unit: useId(),
    year: useId(),
  };
  // The user's choices, ahead of the page that loads them, read as the page
  // reads them.
  const chosen = parseAssetsParams(url.params, {
    portfolioIds: portfolios.map(({ id }) => id),
    tabs,
    salesYears,
  });
  const shown = { ...chosen.filter, unit: chosen.unit ?? referenceUnit };
  const go = (key: AssetsParam, value: string | null) => {
    if (!pending) url.set(key, value);
  };

  // The box follows the page's search when it changes elsewhere, such as a
  // link to the page without one; never to a search the box itself sent, which
  // the user may have typed past since.
  const [search, setSearch] = useState(filter.search);
  const [sent, setSent] = useState(filter.search);
  const [loaded, setLoaded] = useState(filter.search);
  if (filter.search !== loaded) {
    setLoaded(filter.search);
    setSent(filter.search);
    if (filter.search !== sent && filter.search !== searchParamValue(search)) {
      setSearch(filter.search);
    }
  }

  useEffect(() => {
    const typed = searchParamValue(search);
    if (pending || typed === shown.search) return;
    const timer = setTimeout(() => {
      setSent(typed);
      url.set("search", typed || null);
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [search, shown.search, pending, url]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative w-full sm:w-auto sm:min-w-48 sm:flex-1">
        <label htmlFor={ids.search} className="sr-only">
          Buscar
        </label>
        <Search
          aria-hidden
          className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
        />
        <Input
          id={ids.search}
          type="search"
          className="h-8 pl-8"
          placeholder="Buscar activo, ticker o cuenta"
          maxLength={SEARCH_MAX_LENGTH}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>
      <FilterSelect
        id={ids.kind}
        label="Tipo"
        value={shown.assetClass ?? ALL}
        pending={pending}
        options={[
          [ALL, "Todos los tipos"],
          ...ASSET_CLASSES.map(
            (each) => [each, ASSET_CLASS_LABELS[each]] as const,
          ),
        ]}
        onChange={(value) => go("class", value === ALL ? null : value)}
      />
      <FilterSelect
        id={ids.portfolio}
        label="Cartera"
        value={shown.portfolioId ?? ALL}
        pending={pending}
        options={[
          [ALL, "Todas las carteras"],
          ...portfolios.map((each) => [each.id, each.name] as const),
        ]}
        onChange={(value) => go("portfolio", value === ALL ? null : value)}
      />
      {chosen.tab === "sales" && chosen.year !== null && (
        <FilterSelect
          id={ids.year}
          label="Año"
          shownLabel
          value={chosen.year}
          pending={pending}
          options={salesYears.map((year) => [year, year] as const)}
          onChange={(value) =>
            go("year", value === salesYears[0] ? null : value)
          }
        />
      )}
      <FilterSelect
        id={ids.unit}
        label="Valuar en"
        shownLabel
        value={shown.unit}
        pending={pending}
        options={(Object.keys(UNIT_LABELS) as Denominator[]).map(
          (each) => [each, UNIT_LABELS[each]] as const,
        )}
        onChange={(value) => go("unit", unitParam(value, referenceUnit))}
      />
    </div>
  );
}
