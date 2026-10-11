import type { Denominator } from "@plant/core";
import type { ReactNode } from "react";

import { formatAmount, formatShare } from "@/lib/format/amount";
import type { GainLoss } from "@/lib/holdings/cost-totals";
import type { Sum } from "@/lib/holdings/valuation-view";
import { cn } from "@/lib/utils";

// A figure's cell: right-aligned digits that line up; a value's column also
// has room for the longest amount.
export const NUMBER_CELL = "text-right whitespace-nowrap tabular-nums";
export const VALUE_CELL = `w-36 font-medium @2xl:w-40 ${NUMBER_CELL}`;

export const CALCULATING = "Calculando…";
export const NO_QUOTE = "Sin cotización";

export const holdingsCountText = (count: number) =>
  count === 1 ? "1 tenencia" : `${count} tenencias`;

// A figure the page has no value for: a dash, read as what it means.
export function MissingFigure({ text }: { text: string }) {
  return (
    <>
      <span aria-hidden className="text-muted-foreground">
        —
      </span>
      <span className="sr-only">{text}</span>
    </>
  );
}

// An amount in the page's unit, or a dash when it cannot be expressed in it.
export function AmountText({
  amount,
  unit,
}: {
  amount: string | null | undefined;
  unit: Denominator;
}) {
  return amount == null ? (
    <MissingFigure text="Sin valor en esta moneda" />
  ) : (
    formatAmount(amount, unit)
  );
}

// The mark of a figure that leaves holdings out (no quote, or past the list's
// cap); the page's footnotes explain it.
function IncompleteMark() {
  return (
    <>
      <span aria-hidden>*</span>
      <span className="sr-only"> (incompleto)</span>
    </>
  );
}

// A sum of no holdings is a dash; one that leaves holdings out is marked; one
// whose every holding lacks a quote says so.
function SumText({ sum, unit }: { sum: Sum | undefined; unit: Denominator }) {
  if (!sum) return CALCULATING;
  if (sum.count === 0) return <MissingFigure text="Ninguna" />;
  if (sum.missing === sum.count) return NO_QUOTE;
  if (sum.complete) return formatAmount(sum.value, unit);
  return (
    <>
      {formatAmount(sum.value, unit)}
      <IncompleteMark />
    </>
  );
}

// A sum dimmed while a write runs, which may change it.
export function PendingSum({
  sum,
  unit,
  pending,
}: {
  sum: Sum | undefined;
  unit: Denominator;
  pending: boolean;
}) {
  return (
    <span
      className={cn(pending && "opacity-60")}
      aria-busy={pending || undefined}
    >
      <SumText sum={sum} unit={unit} />
    </span>
  );
}

// A share of the whole: "Calculando…" until the server values it (undefined),
// a dash when there is none (null), and marked when its part or the whole
// leaves holdings out (`complete` false), since then the share is off too.
export function ShareText({
  share,
  complete,
}: {
  share: string | null | undefined;
  complete: boolean;
}) {
  if (share === undefined) return CALCULATING;
  if (share === null) return <MissingFigure text="Sin porcentaje" />;
  if (complete) return formatShare(share);
  return (
    <>
      {formatShare(share)}
      <IncompleteMark />
    </>
  );
}

export const signed = (text: string, amount: string) =>
  amount.startsWith("-") || /^0(\.0+)?$/.test(amount) ? text : `+${text}`;

// A gain or loss: "Calculando…" until the page has it (undefined), a dash
// when it is unknown in the unit (null); green when up, red when down, with
// its percent of cost.
export function GainLossText({
  gain,
  unit,
}: {
  gain: GainLoss | null | undefined;
  unit: Denominator;
}) {
  if (gain === undefined) return CALCULATING;
  if (gain === null) return <MissingFigure text="Sin resultado" />;
  const loss = gain.amount.startsWith("-");
  return (
    <span
      className={cn(
        loss ? "text-destructive" : "text-emerald-700 dark:text-emerald-400",
      )}
    >
      {signed(formatAmount(gain.amount, unit), gain.amount)}
      {gain.percent !== null && (
        <span className="block text-xs">
          {signed(formatShare(gain.percent), gain.percent)}
        </span>
      )}
    </span>
  );
}

// One figure of a summary's row of tiles, inside its `dl`: a label, the
// figure, and a muted note under it.
export function SummaryTile({
  label,
  note,
  children,
}: {
  label: string;
  note?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="bg-muted/60 grid gap-1 rounded-lg p-3">
      <dt className="text-muted-foreground text-[11px]">{label}</dt>
      <dd className="truncate text-base font-semibold tabular-nums">
        {children}
      </dd>
      {note !== undefined && (
        <dd className="text-muted-foreground text-[11px] tabular-nums">
          {note}
        </dd>
      )}
    </div>
  );
}
