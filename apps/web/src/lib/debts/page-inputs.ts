import type {
  Denominator,
  Liability,
  QuoteSnapshot,
  ReferenceDollar,
} from "@plant/core";

import type { PledgeOption } from "@/components/debts/debt-collateral-dialog";
import type { CashOption } from "@/components/debts/debt-event-fields";
import { holdingName, holdingPlace } from "@/lib/holdings/holding-name";
import type { HoldingRow, InstrumentRow } from "@/lib/holdings/read";
import { holdingsValuation } from "@/lib/holdings/valuation-view";

// What a debt's page offers from the user's holdings: the cash a payment can
// come from (open cash holdings in the debt's currency) and every open holding
// that can be pledged, valued in the page's unit.
export function debtPageInputs(
  rows: readonly HoldingRow[],
  instruments: readonly InstrumentRow[],
  debt: Pick<Liability, "currency">,
  snapshot: QuoteSnapshot,
  unit: Denominator,
  referenceDollar: ReferenceDollar,
): { cash: CashOption[]; pledgeOptions: PledgeOption[] } {
  const names = new Map(instruments.map((each) => [each.symbol, each.name]));
  const { values } = holdingsValuation({
    holdings: rows,
    truncated: false,
    snapshot,
    unit,
    referenceDollar,
  });
  return {
    cash: rows.flatMap(({ id, holding, ...row }) =>
      holding.asset_class === "cash" && holding.currency === debt.currency
        ? [
            {
              id,
              label: holdingPlace(row),
              currency: holding.currency,
              amount: holding.amount,
            },
          ]
        : [],
    ),
    pledgeOptions: rows.map((row) => ({
      id: row.id,
      label: holdingName(row.holding, names),
      place: holdingPlace(row),
      value: values[row.id]?.value ?? null,
    })),
  };
}
