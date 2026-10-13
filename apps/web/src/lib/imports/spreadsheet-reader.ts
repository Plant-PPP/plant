import "server-only";
import type { ImportJobDeps } from "@plant/jobs";
import { buenosAiresDate } from "@plant/shared";
import {
  type ColumnMapping,
  columnMappingFor,
  readSheet,
  type Sheet,
  sheetToDraft,
} from "@plant/sources/spreadsheet";

import { serverLog } from "@/lib/log/server-log";

import type { ColumnMappingsPort } from "./column-mappings-store";

// Reads a spreadsheet's holdings in code. The model maps a format's columns
// only the first time; the mapping is saved per user, account institution and
// headers once it yields rows, so one that reads nothing is not kept.
export function spreadsheetReader({
  mappings,
  mapColumns,
  now = () => new Date(),
}: {
  mappings: ColumnMappingsPort;
  mapColumns: (input: {
    sheet: Sheet;
    userId: string;
  }) => Promise<ColumnMapping>;
  now?: () => Date;
}): ImportJobDeps["extract"] {
  return async ({ importId, bytes, mimeType, userId, institution }) => {
    const sheet = readSheet(bytes, mimeType);
    const stored = columnMappingFor(sheet.headers).safeParse(
      await mappings.get(userId, institution, sheet.headers),
    );
    const mapping = stored.success
      ? stored.data
      : await mapColumns({ sheet, userId });
    const draft = sheetToDraft(sheet, mapping, buenosAiresDate(now()));
    if (!stored.success && draft.rows.length > 0) {
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
      draft,
      read: { reader: "sheet", mapping: stored.success ? "hit" : "miss" },
    };
  };
}
