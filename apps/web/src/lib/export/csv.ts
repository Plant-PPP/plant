// One file of an export: its name, what the page calls it, and its CSV,
// built when the user asks for it.
export type ExportFile = { name: string; label: string; csv: () => string };

// A table as CSV (RFC 4180): comma-separated, CRLF lines, a field quoted when
// it holds a comma, a quote or a line break, its quotes doubled. A text field
// a spreadsheet would read as a formula starts with an apostrophe, so opening
// the file never runs one; a signed number is left as it is.
export function toCsv(
  header: readonly string[],
  rows: readonly (readonly (string | null)[])[],
): string {
  return [header, ...rows]
    .map((row) => row.map((field) => csvField(field ?? "")).join(","))
    .join("\r\n");
}

const FORMULA = /^[=+@\t\r]|^-(?![\d.])/;
const NUMBER = /^-?\d+(\.\d+)?$/;

function csvField(value: string): string {
  const safe = FORMULA.test(value) && !NUMBER.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}
