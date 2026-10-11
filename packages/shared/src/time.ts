export const BUENOS_AIRES_TZ = "America/Argentina/Buenos_Aires";

const wallClock = new Intl.DateTimeFormat("en-US", {
  timeZone: BUENOS_AIRES_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
  era: "short",
});

// Read from the parts, so no locale's date format is assumed.
function wallClockParts(instant: Date): Record<string, string> {
  return Object.fromEntries(
    wallClock.formatToParts(instant).map((part) => [part.type, part.value]),
  );
}

// The calendar day in Buenos Aires as YYYY-MM-DD, the date a quote is stored
// under (the quote guards in the quotes migration compute the same day). Only
// for the years 1 to 9999: it ignores the era, so 1 BC reads as 0001.
export function buenosAiresDate(instant: Date): string {
  const parts = wallClockParts(instant);
  return `${parts.year?.padStart(4, "0")}-${parts.month}-${parts.day}`;
}

export function buenosAiresHour(instant: Date): number {
  return Number(wallClockParts(instant).hour);
}

// Date.UTC maps years 0 to 99 onto 1900 to 1999; setUTCFullYear does not.
function utc(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
): number {
  const instant = new Date(0);
  instant.setUTCFullYear(year, month - 1, day);
  instant.setUTCHours(hour, minute, second);
  return instant.getTime();
}

const DAY_MS = 86_400_000;

// Throws a RangeError on anything but a YYYY-MM-DD date that exists.
function isoDay(date: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new RangeError("Expected a YYYY-MM-DD date");
  const day = utc(Number(match[1]), Number(match[2]), Number(match[3]));
  if (isoDate(day) !== date)
    throw new RangeError("Expected a date that exists");
  return day;
}

// The UTC calendar day of an instant, for the years 1 to 9999.
function isoDate(instant: number): string {
  const date = new Date(instant);
  const year = date.getUTCFullYear();
  if (year < 1 || year > 9999)
    throw new RangeError("Expected a year 1 to 9999");
  return `${String(year).padStart(4, "0")}${date.toISOString().slice(-20, -14)}`;
}

// How far Buenos Aires' wall clock is from UTC at an instant, in ms.
function offsetAt(instant: number): number {
  const parts = wallClockParts(new Date(instant));
  // The formatter counts the years before 1 as 1 BC, 2 BC and so on.
  const year = parts.era === "BC" ? 1 - Number(parts.year) : Number(parts.year);
  return (
    utc(
      year,
      Number(parts.month),
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second),
    ) - instant
  );
}

// The first instant of a YYYY-MM-DD day in Buenos Aires, with the offset read
// from the time zone database. A clock change near midnight makes the offset
// at UTC midnight differ from the offset at the day's start, so both are tried
// and the earliest instant dated that day wins.
export function startOfBuenosAiresDay(date: string): Date {
  const midnightUtc = isoDay(date);
  const first = midnightUtc - offsetAt(midnightUtc);
  const second = midnightUtc - offsetAt(first);
  const starts = [first, second].filter(
    (instant) => buenosAiresDate(new Date(instant)) === date,
  );
  return new Date(Math.min(...(starts.length > 0 ? starts : [first])));
}

// Calendar arithmetic on YYYY-MM-DD dates, free of any time zone.
export function addDays(date: string, days: number): string {
  return isoDate(isoDay(date) + days * DAY_MS);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((isoDay(to) - isoDay(from)) / DAY_MS);
}
