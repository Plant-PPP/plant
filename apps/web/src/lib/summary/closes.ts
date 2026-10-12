import { addDays } from "@plant/shared";
import type { Denominator, InstrumentType, PeriodResult } from "@plant/core";

import type { MovementLine } from "@/lib/holdings/movements-input";

// A month as the closes name it ("2026-09"), with the day before it starts
// and its last day; the month in progress ends today and is open.
export type Month = { period: string; from: string; to: string; open: boolean };

const firstOf = (period: string) => `${period}-01`;
const nextPeriod = (period: string): string => {
  const [year, month] = period.split("-").map(Number) as [number, number];
  return month === 12
    ? `${year + 1}-01`
    : `${year}-${String(month + 1).padStart(2, "0")}`;
};

// Every month from the one `first` falls in to the one `today` falls in,
// oldest first.
export function monthsBetween(first: string, today: string): Month[] {
  const months: Month[] = [];
  const last = today.slice(0, 7);
  for (let period = first.slice(0, 7); period <= last;) {
    const next = nextPeriod(period);
    const open = period === last;
    months.push({
      period,
      from: addDays(firstOf(period), -1),
      to: open ? today : addDays(firstOf(next), -1),
      open,
    });
    period = next;
  }
  return months;
}

// The units closes are in: a movement carries its date's dollar rates, not
// Bitcoin's price, so its cash flows cannot be expressed in BTC.
export const CLOSE_UNITS = [
  "ars",
  "usd_mep",
  "usd_ccl",
  "usd_official",
] as const satisfies readonly Denominator[];

export const closeUnit = (
  unit: Denominator | null,
  reference: Denominator,
): Denominator =>
  unit !== null && (CLOSE_UNITS as readonly Denominator[]).includes(unit)
    ? unit
    : reference;

// One month's close in the page's unit: its period's result, plus the result
// of its sales (null when unknown in the unit), whether nothing was left out
// (a price at both ends, every movement expressed in the unit, every opening
// balance and adjustment out priced on its day), and when it was last
// recalculated after it closed. `endComplete` is the price check for its end
// alone, the net worth a page shows for today.
export type MonthClose = Month & {
  figures: PeriodResult;
  realized: string | null;
  complete: boolean;
  endComplete: boolean;
  recalculatedOn: string | null;
};

// A year's months and their sum, with its return chained month by month.
export type YearClose = {
  year: string;
  months: MonthClose[];
  totals: {
    startValue: string;
    endValue: string;
    paidIn: string;
    proceeds: string;
    income: string;
    charges: string;
    contributed: string;
    market: string;
    result: string;
    realized: string | null;
    share: string | null;
  };
  complete: boolean;
  open: boolean;
};

// A month's detail: its close and its purchases, sales and income, newest
// first, each with the name of its holding.
export type MonthDetail = {
  close: MonthClose;
  // `atWorth`: an opening balance or adjustment out shown at what it was
  // worth that day, as the close counts it; its price is not shown.
  lines: (MovementLine & {
    holdingName: string;
    instrumentType: InstrumentType | null;
    atWorth: boolean;
  })[];
};

export const MONTH_NAMES = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
];

// A period's month: "Septiembre".
export const monthOf = (period: string): string =>
  MONTH_NAMES[Number(period.slice(5, 7)) - 1]!;

// "Septiembre 2026".
export const monthName = (period: string): string =>
  `${monthOf(period)} ${period.slice(0, 4)}`;

// A period's month inside a sentence: "septiembre de 2026".
export const monthInText = (period: string): string =>
  `${monthOf(period).toLowerCase()} de ${period.slice(0, 4)}`;
