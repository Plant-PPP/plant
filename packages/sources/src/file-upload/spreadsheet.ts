import {
  addDays,
  type Currency,
  currencySchema,
  decimalStringSchema,
  positiveDecimalSchema,
  withoutAccents,
} from "@plant/shared";
import * as XLSX from "xlsx";
import { z } from "zod";

import {
  DRAFT_ROW_LIMIT,
  type DraftRow,
  draftRowSchema,
  type ImportDraft,
  SourceError,
} from "./draft";

// Past it a column is not part of a holdings table; it also bounds a forged
// `!ref` that claims thousands of columns.
const SHEET_COLUMN_LIMIT = 50;
// The longest header a column may have.
const HEADER_LIMIT = 80;
// Headers and a few title or blank rows above the table.
const SHEET_ROW_LIMIT = DRAFT_ROW_LIMIT + 20;

export type SheetCell = string | number;

// The first sheet of a file: its first non-empty row as headers and the rows
// under it.
export type Sheet = { headers: string[]; rows: SheetCell[][] };

const isBlank = (row: readonly SheetCell[]) =>
  row.every((cell) => String(cell).trim() === "");

export function readSheet(bytes: Uint8Array, mimeType: string): Sheet {
  const csv = mimeType === "text/csv";
  let workbook: XLSX.WorkBook;
  try {
    // SheetJS reads CSV bytes as Latin-1, so UTF-8 is decoded here.
    workbook = XLSX.read(csv ? new TextDecoder().decode(bytes) : bytes, {
      type: csv ? "string" : "array",
      sheetRows: SHEET_ROW_LIMIT,
      dense: true,
      raw: csv,
      cellFormula: false,
      cellHTML: false,
      cellStyles: false,
    });
  } catch (cause) {
    throw new SourceError("unreadable", false, { cause });
  }
  const name = workbook.SheetNames[0];
  const sheet = name === undefined ? undefined : workbook.Sheets[name];
  const ref = sheet?.["!ref"];
  if (!sheet || !ref) throw new SourceError("nothing_found", false);
  const range = XLSX.utils.decode_range(ref);
  range.e.c = Math.min(range.e.c, range.s.c + SHEET_COLUMN_LIMIT - 1);
  range.e.r = Math.min(range.e.r, range.s.r + SHEET_ROW_LIMIT - 1);
  const table = XLSX.utils
    .sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: "",
      raw: true,
      range,
    })
    .map((row) =>
      row.map((cell): SheetCell =>
        typeof cell === "number" ? cell : String(cell),
      ),
    );
  const start = table.findIndex((row) => !isBlank(row));
  if (start === -1) throw new SourceError("nothing_found", false);
  const headers = table[start]!.map((cell) => String(cell).trim());
  // Headers name columns: a long one or one across lines is not a table this
  // reads, and the headers reach the model that maps them as they are.
  if (
    headers.some(
      (header) => header.length > HEADER_LIMIT || /[\r\n]/.test(header),
    )
  ) {
    throw new SourceError("unreadable", false);
  }
  return {
    headers,
    rows: table.slice(start + 1).filter((row) => !isBlank(row)),
  };
}

const THOUSANDS_GROUPED = /^-?[1-9]\d{0,2}(\.\d{3})+$/;
const AMBIGUOUS = /^-?[1-9]\d{0,2}[.,]\d{3}$/;
// The currency marks a number may start with; CURRENCY_TOKENS names the same
// ones and more, for a whole cell.
const CURRENCY_PREFIX = /^(u\$s|us\$|ar\$|\$|usd|ars)/i;

const decimalOrNull = (text: string): string | null =>
  decimalStringSchema.safeParse(text).success ? text : null;

// A cell as a decimal string, or null when it is not one. Text with a comma is
// es-AR ("1.234,5"); without one, dots in groups of three are thousands
// ("1.234" is a thousand, "0.001" is not) and any other dot is the decimal
// point. A number cell is cut to the 15 significant digits a float holds, so
// 0.1 + 0.2 reads as 0.3. Signs pass through: the draft schemas refuse what is
// not positive. apps/web's parseAmountInput reads the same es-AR text but
// refuses a lone "1.234", which a keypad types meaning one and a fraction; a
// sheet means a thousand. They become one parser if both read it alike.
// A text cell's number without its spaces or currency mark.
const numberText = (cell: string) =>
  cell.replace(/\s/g, "").replace(CURRENCY_PREFIX, "");

export function parseSheetDecimal(cell: SheetCell): string | null {
  if (typeof cell === "number") {
    if (!Number.isFinite(cell) || Math.abs(cell) >= 1e21) return null;
    const fixed = Number(cell.toPrecision(15))
      .toFixed(8)
      .replace(/\.?0+$/, "");
    return decimalOrNull(fixed === "-0" ? "0" : fixed);
  }
  const text = numberText(cell);
  if (text.includes(",")) {
    const [whole = "", fraction, extra] = text.split(",");
    if (extra !== undefined) return null;
    if (whole.includes(".") && !THOUSANDS_GROUPED.test(whole)) return null;
    return decimalOrNull(`${whole.replace(/\./g, "")}.${fraction}`);
  }
  return decimalOrNull(
    THOUSANDS_GROUPED.test(text) ? text.replace(/\./g, "") : text,
  );
}

const existingDate = (date: string): string | null => {
  try {
    return addDays(date, 0);
  } catch {
    return null;
  }
};

// Day 61 of Excel's calendar, 1900-03-01, is after its phantom 1900-02-29.
const SERIAL_EPOCH = "1899-12-30";
const FIRST_SERIAL = 61;
const LAST_SERIAL = 2958465;

// A cell as a YYYY-MM-DD date, or null: dd/mm/yyyy, d/m/yy (20yy), an ISO
// date, or a spreadsheet date serial.
export function parseSheetDate(cell: SheetCell): string | null {
  if (typeof cell === "number") {
    return cell >= FIRST_SERIAL && cell < LAST_SERIAL + 1
      ? addDays(SERIAL_EPOCH, Math.floor(cell))
      : null;
  }
  const text = cell.trim();
  const local = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(text);
  if (local) {
    const [, day = "", month = "", year = ""] = local;
    return existingDate(
      `${year.length === 2 ? `20${year}` : year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`,
    );
  }
  const iso = /^(\d{4}-\d{2}-\d{2})(T|$)/.exec(text);
  return iso ? existingDate(iso[1]!) : null;
}

const CURRENCY_TOKENS: Record<string, Currency> = {
  ars: "ARS",
  pesos: "ARS",
  $: "ARS",
  ar$: "ARS",
  usd: "USD",
  u$s: "USD",
  us$: "USD",
  dolar: "USD",
  dolares: "USD",
  mep: "USD",
  ccl: "USD",
  cable: "USD",
};

// The currency a cell names when every word in it names the same one: "USD",
// "Dólar MEP", "u$s ccl". Anything else is null.
export function currencyOf(text: string): Currency | null {
  const tokens = withoutAccents(text)
    .toLowerCase()
    .split(/[\s()/,.;:-]+/)
    .filter((token) => token !== "");
  const named = new Set(tokens.map((token) => CURRENCY_TOKENS[token]));
  const [only] = named;
  return named.size === 1 && only !== undefined
    ? currencySchema.parse(only)
    : null;
}

// Which header holds each field of a row, refusing any header the sheet does
// not have, so a mapping from the model or from storage cannot point
// elsewhere.
export function columnMappingFor(headers: readonly string[]) {
  const header = z.enum([...new Set(headers.filter((name) => name !== ""))]);
  return z
    .object({
      symbol: header,
      quantity: header,
      price: header.nullable(),
      value: header.nullable(),
      currency: header.nullable(),
      date: header.nullable(),
      currencyDefault: currencySchema.nullable(),
    })
    .strict();
}

export type ColumnMapping = z.infer<ReturnType<typeof columnMappingFor>>;

// The draft a mapped sheet yields: the first DRAFT_ROW_LIMIT rows that make a
// valid holding, and the latest date of the date column up to `today`
// (YYYY-MM-DD).
export function sheetToDraft(
  sheet: Sheet,
  mapping: ColumnMapping,
  today: string,
): ImportDraft {
  const cellOf = (row: readonly SheetCell[], header: string | null) => {
    const index = header === null ? -1 : sheet.headers.indexOf(header);
    return index === -1 ? "" : (row[index] ?? "");
  };
  // A price or value that is not a positive amount is left out, never the row.
  const optionalDecimal = (cell: SheetCell) => {
    const parsed = String(cell).trim() === "" ? null : parseSheetDecimal(cell);
    return positiveDecimalSchema.safeParse(parsed).success ? parsed : null;
  };
  // "1.500" is a thousand and a half in es-AR and one and a half with a dot
  // keypad, and "1,500" the other way round: read as es-AR, but for the user
  // to check.
  const ambiguous = (cell: SheetCell) =>
    typeof cell === "string" && AMBIGUOUS.test(numberText(cell));

  const rows: DraftRow[] = [];
  let documentDate: string | null = null;
  for (const row of sheet.rows) {
    const date =
      mapping.date === null ? null : parseSheetDate(cellOf(row, mapping.date));
    if (
      date !== null &&
      date <= today &&
      (documentDate === null || date > documentDate)
    ) {
      documentDate = date;
    }
    if (rows.length === DRAFT_ROW_LIMIT) continue;
    const figures = [mapping.quantity, mapping.price, mapping.value].map(
      (header) => cellOf(row, header),
    );
    const parsed = draftRowSchema.safeParse({
      symbol: String(cellOf(row, mapping.symbol)),
      quantity: parseSheetDecimal(cellOf(row, mapping.quantity)),
      price: optionalDecimal(cellOf(row, mapping.price)),
      value: optionalDecimal(cellOf(row, mapping.value)),
      currency:
        currencyOf(String(cellOf(row, mapping.currency))) ??
        mapping.currencyDefault,
      confidence: figures.some(ambiguous) ? "low" : "high",
      page: null,
    });
    if (parsed.success) rows.push(parsed.data);
  }
  return { documentDate, rows, totals: [] };
}
