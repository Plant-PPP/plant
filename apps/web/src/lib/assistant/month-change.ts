import { exactOf } from "@plant/shared";

import { type ChangeBetween } from "@/lib/summary/compute";
import { monthInText, monthName } from "@/lib/summary/closes";

import type { ChartPart, ChatUnit } from "./chat";

// The months a change covers, in a sentence: "septiembre de 2026", or "junio
// de 2026 a septiembre de 2026".
export const changePeriod = (change: Pick<ChangeBetween, "from" | "to">) =>
  change.from === change.to
    ? monthInText(change.from)
    : `${monthInText(change.from)} a ${monthInText(change.to)}`;

// The month a summary is of when none is asked for: the last one closed, or
// the one in progress when none has closed yet.
export const lastClosed = (
  closes: readonly { period: string; open: boolean }[],
): string | undefined =>
  closes.findLast((each) => !each.open)?.period ?? closes.at(-1)?.period;

// Where a change came from, as a waterfall: net worth at the start, each
// part, and net worth at the end. The parts add up to the end exactly; what
// yields added and what the debts' interest cost show only when nonzero.
export function changeChart(change: ChangeBetween, unit: ChatUnit): ChartPart {
  const contributed = exactOf(change.contributed).n;
  const title =
    change.from === change.to
      ? `Cómo cambió tu patrimonio en ${monthName(change.from).toLowerCase()}`
      : "Cómo cambió tu patrimonio";
  return {
    kind: "bars",
    template: "waterfall",
    title,
    unit,
    points: [
      { label: "Al empezar", value: change.startValue },
      {
        label: contributed < 0n ? "Lo que sacaste" : "Lo que pusiste",
        value: change.contributed,
      },
      { label: "Precios", value: change.prices },
      { label: "Dólar", value: change.dollar },
      ...(exactOf(change.yields).n === 0n
        ? []
        : [{ label: "Rendimientos", value: change.yields }]),
      ...(exactOf(change.interest).n === 0n
        ? []
        : [{ label: "Intereses de deudas", value: change.interest }]),
      { label: "Al terminar", value: change.endValue },
    ],
  };
}
