import type { Denominator } from "@plant/core";

import { currencyOf } from "@/lib/holdings/holding-name";
import {
  type HoldingsValuation,
  holdingsValuation,
} from "@/lib/holdings/valuation-view";
import { pricedToday as pricedTodayOf } from "@/lib/summary/compute";
import type { ClosesRead } from "@/lib/summary/read";

// Today's quotes for Resumen, as the closes value their last day.
export const pricedToday = ({ state }: ClosesRead) => pricedTodayOf(state);

// What Resumen shows split today: the holdings of one portfolio, or of all
// with null, valued in a unit. Throws when the valuation fails.
export function summaryValuation(
  read: ClosesRead,
  { unit, portfolioId }: { unit: Denominator; portfolioId: string | null },
): { rows: ClosesRead["holdings"]["active"]; valuation: HoldingsValuation } {
  const { state } = read;
  const rows = read.holdings.active.filter(
    (row) => portfolioId === null || row.portfolio.id === portfolioId,
  );
  const valuation = holdingsValuation({
    holdings: rows,
    truncated: read.holdings.activeTruncated,
    snapshot: pricedToday(read),
    unit,
    referenceDollar: state.referenceDollar,
    currencyOf: (holding) =>
      holding.asset_class === "instrument"
        ? currencyOf(state.instruments, holding.instrument_symbol)
        : holding.currency,
  });
  return { rows, valuation };
}
