export const BUENOS_AIRES_TZ = "America/Argentina/Buenos_Aires";

const dateParts = new Intl.DateTimeFormat("en-US", {
  timeZone: BUENOS_AIRES_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

// The calendar day in Buenos Aires as YYYY-MM-DD, the date a quote is stored
// under. Read from the parts, so no locale's date format is assumed.
export function buenosAiresDate(instant: Date): string {
  const parts = Object.fromEntries(
    dateParts.formatToParts(instant).map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}
