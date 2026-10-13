import type { Denominator } from "@plant/core";
import type { Currency } from "@plant/shared";

import { PendingSum, ShareText } from "@/components/holdings/sum-text";
import type { Sum } from "@/lib/holdings/valuation-view";

const CURRENCY_NAMES: Record<Currency, string> = {
  ARS: "En pesos",
  USD: "En dólares",
};

// What is held in each currency, valued in the page's unit, with its share.
export function CurrenciesBreakdown({
  currencies,
  unit,
}: {
  currencies: Partial<Record<Currency, Sum>>;
  unit: Denominator;
}) {
  const lines = (Object.keys(CURRENCY_NAMES) as Currency[]).flatMap(
    (currency) => {
      const sum = currencies[currency];
      return sum && sum.count > 0 ? [{ currency, sum }] : [];
    },
  );
  return (
    <dl className="grid gap-2 sm:grid-cols-2">
      {lines.map(({ currency, sum }) => (
        <div
          key={currency}
          className="flex items-baseline justify-between gap-3 rounded-lg border p-3"
        >
          <dt className="text-sm">
            {CURRENCY_NAMES[currency]}
            <span className="text-muted-foreground ml-2 text-xs tabular-nums">
              <ShareText share={sum.share} complete={sum.complete} />
            </span>
          </dt>
          <dd className="text-sm font-medium tabular-nums">
            <PendingSum sum={sum} unit={unit} pending={false} />
          </dd>
        </div>
      ))}
    </dl>
  );
}
