// The number format Vega's d3-format takes for a locale, read from Intl: in
// es-AR, a comma before the decimals and a dot between thousands. A spec asks
// for ",.0f" and the locale picks the marks.
export function d3FormatLocale(locale: string) {
  const parts = new Intl.NumberFormat(locale).formatToParts(-12345.6);
  const part = (type: Intl.NumberFormatPartTypes, fallback: string) =>
    parts.find((each) => each.type === type)?.value ?? fallback;
  return {
    decimal: part("decimal", "."),
    thousands: part("group", ","),
    grouping: [3],
    minus: part("minusSign", "-"),
    currency: ["", ""] as [string, string],
  };
}
