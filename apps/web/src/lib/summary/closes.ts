import { addDays } from "@plant/shared";
import type { InstrumentType, PeriodResult } from "@plant/core";

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

// One month's close in the page's unit: its period's result, plus its charges
// and the result of its sales (null when unknown in the unit), whether every
// holding had a price at both ends, and when it was last recalculated after
// it closed.
export type MonthClose = Month & {
  figures: PeriodResult;
  charges: string | null;
  realized: string | null;
  complete: boolean;
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
    contributed: string;
    market: string;
    result: string;
    charges: string | null;
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
  lines: (MovementLine & {
    holdingName: string;
    instrumentType: InstrumentType | null;
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

// "Septiembre 2026".
// A period's month: "Septiembre".
export const monthOf = (period: string): string =>
  MONTH_NAMES[Number(period.slice(5, 7)) - 1]!;

// "Septiembre 2026".
export const monthName = (period: string): string =>
  `${monthOf(period)} ${period.slice(0, 4)}`;
