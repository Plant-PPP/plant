import type { Denominator } from "@plant/core";

import { GainLossText } from "@/components/holdings/sum-text";
import { Badge } from "@/components/ui/badge";
import { formatFraction, percentOf } from "@/lib/format/amount";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/format/date";
import type { MonthClose } from "@/lib/summary/closes";

// A result, green when up, red when down and muted when it shows zero, with
// its return under it.
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

// A change or a return as a percent with its sign: coloured green or red when
// `colored`, a dash when it could not be measured.
export function ShareText({
  share,
  colored = false,
}: {
  share: string | null;
  colored?: boolean;
}) {
  if (share === null) return <span className="text-muted-foreground">—</span>;
  const sign = Math.sign(Number(percentOf(share)));
  return (
    <span
      className={cn(
        colored && sign > 0 && "text-emerald-700 dark:text-emerald-400",
        colored && sign < 0 && "text-destructive",
      )}
    >
      {`${sign > 0 ? "+" : ""}${formatFraction(share)}`}
    </span>
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
    <Badge
      variant={
        close.open ? "info" : close.recalculatedOn ? "warning" : "neutral"
      }
    >
      {text}
    </Badge>
  );
}
