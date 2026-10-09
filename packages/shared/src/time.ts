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
});

// Read from the parts, so no locale's date format is assumed.
function wallClockParts(instant: Date): Record<string, string> {
  return Object.fromEntries(
    wallClock.formatToParts(instant).map((part) => [part.type, part.value]),
  );
}

// The calendar day in Buenos Aires as YYYY-MM-DD, the date a quote is stored
// under (the quote guards in the quotes migration compute the same day). Only
// for the years 1 to 9999: the formatter drops the era of earlier years.
export function buenosAiresDate(instant: Date): string {
  const parts = wallClockParts(instant);
  return `${parts.year?.padStart(4, "0")}-${parts.month}-${parts.day}`;
}

// The hour in Buenos Aires, 0 to 23.
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

// How far Buenos Aires' wall clock is from UTC at an instant, in ms.
function offsetAt(instant: number): number {
  const parts = wallClockParts(new Date(instant));
  return (
    utc(
      Number(parts.year),
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
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match || match[1] === "0000") {
    throw new RangeError("Expected a YYYY-MM-DD date from the year 1");
  }
  const midnightUtc = utc(Number(match[1]), Number(match[2]), Number(match[3]));
  if (new Date(midnightUtc).toISOString().slice(0, 10) !== date) {
    throw new RangeError("Expected a date that exists");
  }
  const first = midnightUtc - offsetAt(midnightUtc);
  const second = midnightUtc - offsetAt(first);
  const starts = [first, second].filter(
    (instant) => buenosAiresDate(new Date(instant)) === date,
  );
  return new Date(Math.min(...(starts.length > 0 ? starts : [first])));
}
