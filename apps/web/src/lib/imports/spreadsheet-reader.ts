import "server-only";
import { validateHoldings } from "@plant/core";
import { buenosAiresDate } from "@plant/shared";
import type { HoldingsReading, ImportDraft, SourceInput } from "@plant/sources";
import {
  type ColumnMapping,
  columnMappingFor,
  readSheet,
  type Sheet,
  sheetToDraft,
} from "@plant/sources/spreadsheet";

import { serverLog } from "@/lib/log/server-log";

import type { ColumnMappingsPort } from "./column-mappings-store";

// Whether a reading looks right enough to keep its mapping: it reads more rows
// than rows with a quantity it cannot, and when the rows print quantity, price
// and value, most of them agree, at a price per unit or per 100 nominal.
function looksRight({
  draft,
  unreadRows,
}: {
  draft: ImportDraft;
  unreadRows: number;
}): boolean {
  if (draft.rows.length <= unreadRows) return false;
  const priced = draft.rows.filter(
    (row) => row.price !== null && row.value !== null,
  );
  if (priced.length === 0) return true;
  const issuesAt = (basis: 1 | 100) =>
    validateHoldings(priced.map((row) => ({ ...row, symbol: "", basis })));
  const perUnit = issuesAt(1);
  const perHundred = issuesAt(100);
  const agreeing = priced.filter(
    (_, i) =>
      !perUnit[i]!.includes("value_mismatch") ||
      !perHundred[i]!.includes("value_mismatch"),
  ).length;
  return agreeing * 2 > priced.length;
}

// Reads a spreadsheet's holdings in code. The model maps a format's columns
// only the first time; the mapping is saved per user, account institution and
// headers once a reading with it looks right, so a wrong one is asked again.
export function spreadsheetReader({
  mappings,
  mapColumns,
  now = () => new Date(),
}: {
  mappings: ColumnMappingsPort;
  mapColumns: (input: {
    sheet: Sheet;
    userId: string;
    importId: string;
  }) => Promise<ColumnMapping>;
  now?: () => Date;
}): (input: SourceInput) => Promise<HoldingsReading> {
  return async ({ importId, bytes, mimeType, userId, institution }) => {
    const sheet = readSheet(bytes, mimeType);
    const stored = columnMappingFor(sheet.headers).safeParse(
      await mappings.get(userId, institution, sheet.headers),
    );
    const mapping = stored.success
      ? stored.data
      : await mapColumns({ sheet, userId, importId });
    const reading = sheetToDraft(sheet, mapping, buenosAiresDate(now()));
    if (!stored.success && looksRight(reading)) {
      await mappings
        .save(userId, institution, sheet.headers, mapping)
        .catch((error: unknown) =>
          serverLog.warn("imports.column_mapping", {
            "plant.import.id": importId,
            "enduser.id": userId,
            "plant.outcome": "failed",
            "error.type": error instanceof Error ? error.name : "unknown",
          }),
        );
    }
    return {
      draft: reading.draft,
      read: {
        reader: "sheet",
        mapping: stored.success ? "hit" : "miss",
        skippedRows: reading.skippedRows,
        disputes: 0,
        documentKind: null,
      },
    };
  };
}
