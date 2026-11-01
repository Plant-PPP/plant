import "server-only";
import { neutralizePromptText } from "@plant/shared";
import { readSheet, type SheetCell } from "@plant/sources/spreadsheet";

import { bytesMatch } from "@/lib/imports/upload";

import { type Attachment, SPREADSHEET_TYPES } from "./attachments";

const csvCell = (cell: SheetCell) => {
  const text = neutralizePromptText(String(cell));
  return /[",]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

// What the model reads of an attached spreadsheet: its first sheet as CSV
// lines, every cell as untrusted text, or that it could not be read: one
// whose first bytes are not of its type included.
export function spreadsheetText(file: Attachment): string {
  const name = neutralizePromptText(file.filename);
  const unread = `(planilla ${name}: no se pudo leer)`;
  const bytes = Buffer.from(file.data, "base64");
  const type = SPREADSHEET_TYPES.find((each) => each === file.mediaType);
  if (!type || !bytesMatch(type, bytes)) return unread;
  let sheet;
  try {
    sheet = readSheet(bytes, type);
  } catch {
    return unread;
  }
  const lines = [sheet.headers, ...sheet.rows].map((row) =>
    row.map(csvCell).join(","),
  );
  return [
    `(planilla ${name}, primera hoja${sheet.truncated ? ", solo las primeras filas" : ""}:)`,
    ...lines,
  ].join("\n");
}
