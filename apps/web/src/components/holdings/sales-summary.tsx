import type { Denominator } from "@plant/core";

import type { SalesSlice } from "@/lib/holdings/movements-input";

import { AmountText, GainLossText } from "./sum-text";
import { StatTile } from "@/components/ui/stat-tile";

const amount = (value: string | null | undefined, unit: Denominator) => (
  <AmountText amount={value} unit={unit} />
);

// The year's sales in four tiles: how many, what they brought in, their fees
// and taxes, and their result.
export function SalesSummary({
  totals,
  unit,
  year,
}: {
  totals: SalesSlice["totals"];
  unit: Denominator;
  year: string;
}) {
  return (
    <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <StatTile label="Operaciones" note={`Ventas de ${year}`}>
        {totals.count}
      </StatTile>
      <StatTile label="Bruto">{amount(totals.gross, unit)}</StatTile>
      <StatTile label="Comisiones e impuestos">
        {amount(totals.charges, unit)}
      </StatTile>
      <StatTile label="Resultado">
        <GainLossText
          gain={
            totals.result === null
              ? null
              : { amount: totals.result, percent: null }
          }
          unit={unit}
        />
      </StatTile>
    </dl>
  );
}
