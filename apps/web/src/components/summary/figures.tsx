import type { Denominator } from "@plant/core";

import { GainLossText } from "@/components/holdings/sum-text";
import { percentOf } from "@/lib/format/amount";
import { formatDate } from "@/lib/format/date";
import type { MonthClose } from "@/lib/summary/closes";

// A result, green when up and red when down, with its return under it.
export function ResultText({
  amount,
  share,
  unit,
}: {
  amount: string;
  share: string | null;
  unit: Denominator;
}) {
  return (
    <GainLossText
      gain={{ amount, percent: share === null ? null : percentOf(share) }}
      unit={unit}
    />
  );
}

// Where a close stands: in progress, closed, or recalculated after it closed.
export function CloseStatus({
  close,
}: {
  close: Pick<MonthClose, "open" | "recalculatedOn">;
}) {
  const text = close.open
    ? "En curso"
    : close.recalculatedOn
      ? `Recalculado el ${formatDate(close.recalculatedOn)}`
      : "Cerrado";
  return (
    <span
      className={
        close.open
          ? "bg-primary/15 text-foreground rounded px-1.5 py-0.5 text-xs"
          : close.recalculatedOn
            ? "rounded bg-amber-500/15 px-1.5 py-0.5 text-xs text-amber-700 dark:text-amber-300"
            : "bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-xs"
      }
    >
      {text}
    </span>
  );
}
