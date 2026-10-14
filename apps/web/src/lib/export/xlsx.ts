import type { ExportTable } from "./csv";

// A plain decimal a spreadsheet keeps exactly: at most 15 significant digits.
const DECIMAL = /^-?(\d+(\.\d+)?|\.\d+)$/;
const EXACT_DIGITS = 15;

// A field as an Excel cell: a decimal that fits a double exactly is a number,
// anything else is text, never a formula. Digits with a leading zero, as a
// reference, stay text so the zeros are kept.
export function cellOf(value: string | null): string | number | null {
  if (value === null) return null;
  if (!DECIMAL.test(value) || /^-?0\d/.test(value)) return value;
  const digits = value
    .replace(/^-/, "")
    .replace(/(\.\d*?)0+$/, "$1")
    .replace(".", "")
    .replace(/^0+/, "");
  return digits.length <= EXACT_DIGITS ? Number(value) : value;
}

// The sheet name Excel takes: at most 31 characters and none of : \ / ? * [ ].
const sheetName = (label: string) =>
  label.replace(/[:\\/?*[\]]/g, " ").slice(0, 31);

// Every table as one sheet of an .xlsx workbook. SheetJS loads only when the
// user asks for the file.
export async function xlsxBlob(tables: readonly ExportTable[]): Promise<Blob> {
  const XLSX = await import("xlsx");
  const book = XLSX.utils.book_new();
  for (const table of tables) {
    const sheet = XLSX.utils.aoa_to_sheet([
      [...table.header],
      ...table.rows.map((row) => row.map(cellOf)),
    ]);
    XLSX.utils.book_append_sheet(book, sheet, sheetName(table.label));
  }
  const bytes = XLSX.write(book, {
    type: "array",
    bookType: "xlsx",
  }) as ArrayBuffer;
  return new Blob([bytes], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}
