import type { KeysetParams } from "@/lib/supabase/keyset";

import {
  type AssetsTabs,
  matchesFilter,
  parseAssetsParams,
} from "./assets-filter";
import type { HoldingRow } from "./read";

// What an assets page shows for its params: the parsed choices and the active
// holdings they keep. Both the real page and the prototype read through it.
export function assetsSelection<Row extends HoldingRow>({
  params,
  rows,
  portfolioIds,
  tabs,
  salesYears,
  names,
}: {
  params: KeysetParams;
  rows: readonly Row[];
  portfolioIds: readonly string[];
  tabs: AssetsTabs;
  salesYears: readonly string[];
  names: ReadonlyMap<string, string>;
}) {
  const parsed = parseAssetsParams(params, { portfolioIds, tabs, salesYears });
  return {
    ...parsed,
    shown: rows.filter((row) => matchesFilter(row, parsed.filter, names)),
  };
}
