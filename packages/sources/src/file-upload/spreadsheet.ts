import {
  addDays,
  type Currency,
  currencySchema,
  decimalStringSchema,
  neutralizePromptText,
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
import { isZip, zipFitsLimit } from "./zip";

// Past it a column is not part of a holdings table; it also bounds a forged
// `!ref` that claims thousands of columns.
const SHEET_COLUMN_LIMIT = 50;
// The longest header a column may have.
const HEADER_LIMIT = 80;
// Headers and a few title or blank rows above the table. Blank rows count
// towards it.
const SHEET_ROW_LIMIT = DRAFT_ROW_LIMIT + 20;
// The rows read past SHEET_ROW_LIMIT to tell a table that goes on from the
// blank lines or styled empty cells spreadsheet apps leave under it.
const SHEET_LOOKAHEAD_ROWS = SHEET_ROW_LIMIT;
// SheetJS counts sheetRows from row 1, not from the used range, which may
// start up to SHEET_ROW_LIMIT rows down and still be read whole.
const SHEET_PARSE_ROWS = 2 * SHEET_ROW_LIMIT + SHEET_LOOKAHEAD_ROWS;

export type SheetCell = string | number;

// The first sheet of a file: its first non-empty row as headers and the rows
// under it, within SHEET_ROW_LIMIT rows from the top of its used range.
// `truncated` when a non-blank row comes past them, or the sheet goes on past
// the lookahead read to tell, and those rows are not read.
export type Sheet = {
  headers: string[];
  rows: SheetCell[][];
  truncated?: boolean;
};

const isBlank = (row: readonly SheetCell[]) =>
  row.every((cell) => String(cell).trim() === "");

// SheetJS reads CSV bytes as Latin-1, so they are decoded here: as UTF-8, or
// as Windows-1252, which spreadsheet apps on Windows export, when they are not
// UTF-8.
const csvText = (bytes: Uint8Array) => {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
};

export function readSheet(bytes: Uint8Array, mimeType: string): Sheet {
  const csv = mimeType === "text/csv";
  const text = csv ? csvText(bytes) : null;
  // SheetJS opens a CSV's text as a zip when it starts like one, after the
  // decoder drops a byte-order mark; no real CSV does.
  if (text !== null && isZip(new TextEncoder().encode(text.slice(0, 4)))) {
    throw new SourceError("unreadable", false);
  }
  if (!csv && isZip(bytes) && !zipFitsLimit(bytes)) {
    throw new SourceError("unreadable", false);
  }
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(text ?? bytes, {
      type: csv ? "string" : "array",
      sheetRows: SHEET_PARSE_ROWS,
      dense: true,
      raw: csv,
      cellFormula: false,
      cellHTML: false,
      cellStyles: false,
    });
  } catch {
    throw new SourceError("unreadable", false);
  }
  const name = workbook.SheetNames[0];
  const sheet = name === undefined ? undefined : workbook.Sheets[name];
  const ref = sheet?.["!ref"];
  if (!sheet || !ref) throw new SourceError("nothing_found", false);
  const range = XLSX.utils.decode_range(ref);
  // SheetJS sets `!fullref` whenever the sheet claims rows past sheetRows,
  // a styled empty cell far below included; only a parse that reached
  // SHEET_PARSE_ROWS left rows unread.
  const parseCapped =
    sheet["!fullref"] !== undefined && range.e.r >= SHEET_PARSE_ROWS - 1;
  range.e.c = Math.min(range.e.c, range.s.c + SHEET_COLUMN_LIMIT - 1);
  range.e.r = Math.min(
    range.e.r,
    range.s.r + SHEET_ROW_LIMIT + SHEET_LOOKAHEAD_ROWS - 1,
  );
  const read = XLSX.utils
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
  const table = read.slice(0, SHEET_ROW_LIMIT);
  const lookahead = read.slice(SHEET_ROW_LIMIT);
  const truncated =
    lookahead.some((row) => !isBlank(row)) ||
    (parseCapped && lookahead.length === 0);
  const start = table.findIndex((row) => !isBlank(row));
  if (start === -1) throw new SourceError("nothing_found", false);
  const headers = table[start]!.map((cell) => String(cell).trim());
  // Headers name columns: a long one, or one across lines or with an angle
  // bracket, is not a table this reads; the headers reach the model that maps
  // them as they are, in its answer's schema too.
  if (
    headers.some(
      (header) =>
        header.length > HEADER_LIMIT || neutralizePromptText(header) !== header,
    )
  ) {
    throw new SourceError("unreadable", false);
  }
  return {
    headers,
    rows: table.slice(start + 1).filter((row) => !isBlank(row)),
    ...(truncated && { truncated }),
  };
}

const THOUSANDS_GROUPED = /^-?[1-9]\d{0,2}(\.\d{3})+$/;
const US_NUMBER = /^-?(\d{1,3}(,\d{3})+|\d+)(\.\d+)?$/;
// Text only a US sheet writes ("1,234.56", "1,234,567", "230.50") and text
// only an es-AR one writes ("12,5", "1.234,56", "1.234.567").
const US_ONLY = [
  /^-?\d{1,3}(,\d{3})+\.\d+$/,
  /^-?\d{1,3}(,\d{3}){2,}$/,
  /^-?\d+\.\d{1,2}$/,
];
const ES_AR_ONLY = [
  /\d,\d{1,2}$/,
  /,\d{4,}$/,
  /\d{4},/,
  /\.\d{3},/,
  /^-?\d{1,3}(\.\d{3}){2,}$/,
];
const AMBIGUOUS = /^-?[1-9]\d{0,2}[.,]\d{3}$/;
// The currency marks a number may start with; CURRENCY_TOKENS names the same
// ones and more, for a whole cell.
const CURRENCY_PREFIX = /^(u\$s|us\$|ar\$|\$|usd|ars)/i;

const decimalOrNull = (text: string): string | null =>
  decimalStringSchema.safeParse(text).success ? text : null;

// A text cell's number without its spaces or currency mark.
const numberText = (cell: string) =>
  cell.replace(/\s/g, "").replace(CURRENCY_PREFIX, "");

// How a column writes its numbers: es-AR (dot thousands, comma decimal) or US
// (comma thousands, dot decimal).
export type NumberConvention = "es-AR" | "US";

// The convention some cells show: es-AR when any is written only as an es-AR
// sheet would, US when any is written only as a US one would and none is
// es-AR, and null when nothing tells them apart ("1,500", "1.234", "10").
export function numberConventionOf(
  cells: readonly SheetCell[],
): NumberConvention | null {
  // Only cells written as a number: a note in the column says nothing.
  const texts = cells
    .filter((cell): cell is string => typeof cell === "string")
    .map(numberText)
    .filter((text) => /^-?[\d.,]+$/.test(text));
  const writes = (patterns: readonly RegExp[]) =>
    texts.some((text) => patterns.some((pattern) => pattern.test(text)));
  if (writes(ES_AR_ONLY)) return "es-AR";
  return writes(US_ONLY) ? "US" : null;
}

// A cell as a decimal string, or null when it is not one. In es-AR, text with
// a comma is es-AR ("1.234,5"); without one, dots in groups of three are
// thousands ("1.234" is a thousand, "0.001" is not) and any other dot is the
// decimal point. In US, commas group thousands and a dot is the decimal point.
// A number cell is cut to the 15 significant digits a float holds, so
// 0.1 + 0.2 reads as 0.3. Signs pass through: the draft schemas refuse what is
// not positive. apps/web's parseAmountInput reads the same es-AR text but
// refuses a lone "1.234", which a keypad types meaning one and a fraction; a
// sheet means a thousand. They become one parser if both read it alike.
export function parseSheetDecimal(
  cell: SheetCell,
  convention: NumberConvention = "es-AR",
): string | null {
  if (typeof cell === "number") {
    if (!Number.isFinite(cell) || Math.abs(cell) >= 1e21) return null;
    const fixed = Number(cell.toPrecision(15))
      .toFixed(8)
      .replace(/\.?0+$/, "");
    return decimalOrNull(fixed === "-0" ? "0" : fixed);
  }
  const text = numberText(cell);
  if (convention === "US") {
    return US_NUMBER.test(text) ? decimalOrNull(text.replace(/,/g, "")) : null;
  }
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
      // Mappings saved before a sheet's cost or account was read have none.
      cost: header.nullable().optional(),
      account: header.nullable().optional(),
      currency: header.nullable(),
      date: header.nullable(),
      currencyDefault: currencySchema.nullable(),
    })
    .strict();
}

export type ColumnMapping = z.infer<ReturnType<typeof columnMappingFor>>;

// The draft a mapped sheet yields: the first DRAFT_ROW_LIMIT rows that make a
// valid holding, and the latest date of the date column up to `today`
// (YYYY-MM-DD). `skippedRows` are the holdings it leaves out, for the user:
// rows with a symbol and a quantity that make none or come past the limit,
// and at least one when the sheet was truncated, whose unread rows it cannot
// count. `unreadRows` are the rows before the limit with a quantity that make
// no holding, symbol or not, for telling whether a mapping reads the sheet.
export function sheetToDraft(
  sheet: Sheet,
  mapping: ColumnMapping,
  today: string,
): { draft: ImportDraft; skippedRows: number; unreadRows: number } {
  const cellOf = (row: readonly SheetCell[], header: string | null) => {
    const index = header === null ? -1 : sheet.headers.indexOf(header);
    return index === -1 ? "" : (row[index] ?? "");
  };
  // Each figure column reads as its cells show, or as the figure columns
  // together show when its own cells tell nothing, or else as es-AR.
  const cellsOf = (header: string | null) =>
    sheet.rows.map((row) => cellOf(row, header));
  const figureHeaders = [mapping.quantity, mapping.price, mapping.value];
  const costHeader = mapping.cost ?? null;
  const accountOf = (row: readonly SheetCell[]) =>
    mapping.account
      ? String(cellOf(row, mapping.account)).trim().slice(0, 60) || undefined
      : undefined;
  const sheetConvention =
    numberConventionOf(figureHeaders.flatMap(cellsOf)) ?? "es-AR";
  const conventionOf = (header: string | null) =>
    numberConventionOf(cellsOf(header)) ?? sheetConvention;
  const conventions = {
    quantity: conventionOf(mapping.quantity),
    price: conventionOf(mapping.price),
    value: conventionOf(mapping.value),
    cost: conventionOf(costHeader),
  };
  // A price or value that is not a positive amount is left out, never the row.
  const optionalDecimal = (cell: SheetCell, convention: NumberConvention) => {
    const parsed =
      String(cell).trim() === "" ? null : parseSheetDecimal(cell, convention);
    return positiveDecimalSchema.safeParse(parsed).success ? parsed : null;
  };
  // "1.500" is a thousand and a half in es-AR and one and a half with a dot
  // keypad, and "1,500" the other way round: read as its column's convention,
  // but for the user to check.
  const ambiguous = (cell: SheetCell) =>
    typeof cell === "string" && AMBIGUOUS.test(numberText(cell));

  const rows: DraftRow[] = [];
  let skippedRows = 0;
  let unreadRows = 0;
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
    // A row with a symbol and a quantity is a holding; one without either is
    // a section's title or a total.
    const holding =
      String(cellOf(row, mapping.symbol)).trim() !== "" &&
      String(cellOf(row, mapping.quantity)).trim() !== "";
    if (rows.length === DRAFT_ROW_LIMIT) {
      if (holding) skippedRows += 1;
      continue;
    }
    const figures = [...figureHeaders, costHeader].map((header) =>
      cellOf(row, header),
    );
    // A currency cell names the row's currency or, when it names none Plant
    // keeps, makes no holding; an empty one takes the model's default, for
    // the user to check.
    const currencyCell = String(cellOf(row, mapping.currency)).trim();
    const named = currencyCell === "" ? null : currencyOf(currencyCell);
    const currency = currencyCell === "" ? mapping.currencyDefault : named;
    const parsed = draftRowSchema.safeParse({
      symbol: String(cellOf(row, mapping.symbol)),
      quantity: parseSheetDecimal(
        cellOf(row, mapping.quantity),
        conventions.quantity,
      ),
      price: optionalDecimal(cellOf(row, mapping.price), conventions.price),
      value: optionalDecimal(cellOf(row, mapping.value), conventions.value),
      ...(costHeader !== null && {
        cost: optionalDecimal(cellOf(row, costHeader), conventions.cost),
      }),
      ...(accountOf(row) && { account: accountOf(row) }),
      currency,
      confidence: figures.some(ambiguous)
        ? "low"
        : named === null
          ? "medium"
          : "high",
      page: null,
    });
    if (parsed.success) rows.push(parsed.data);
    else {
      if (holding) skippedRows += 1;
      if (String(cellOf(row, mapping.quantity)).trim() !== "") unreadRows += 1;
    }
  }
  return {
    draft: { documentDate, rows, totals: [] },
    skippedRows: sheet.truncated ? Math.max(skippedRows, 1) : skippedRows,
    unreadRows,
  };
}
