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
// under (the quote guards in the quotes migration compute the same day).
export function buenosAiresDate(instant: Date): string {
  const parts = wallClockParts(instant);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

// The hour in Buenos Aires, 0 to 23.
export function buenosAiresHour(instant: Date): number {
  return Number(wallClockParts(instant).hour);
}

// The instant a YYYY-MM-DD day starts in Buenos Aires. The offset is read from
// the time zone database at that day, not assumed.
export function startOfBuenosAiresDay(date: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new RangeError("Expected a YYYY-MM-DD date");
  const midnightUtc = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
  );
  const parts = wallClockParts(new Date(midnightUtc));
  const wallAsUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return new Date(midnightUtc - (wallAsUtc - midnightUtc));
}
