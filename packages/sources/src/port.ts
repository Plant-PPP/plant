import { z } from "zod";

import type { ImportDraft } from "./file-upload/draft";

// Where a connection's holdings come from: today only a file the user
// uploads. A broker or exchange API arrives as another kind and adapter.
export const sourceKindSchema = z.enum(["file_upload"]);
export type SourceKind = z.infer<typeof sourceKindSchema>;

// Whether a source can do something at all; a caller checks it before asking.
export const supportSchema = z.enum(["native", "unsupported"]);

// What a source can read: the holdings at a date, the movements that led to
// them, and only what changed since the last read.
export const sourceCapabilitiesSchema = z
  .object({
    holdings: supportSchema,
    movements: supportSchema,
    incremental: supportSchema,
  })
  .strict();
export type SourceCapabilities = z.infer<typeof sourceCapabilitiesSchema>;

// What one read asks for: a file the user uploaded to an import.
export type SourceInput = {
  importId: string;
  bytes: Uint8Array;
  mimeType: string;
  userId: string;
  institution: string;
};

// How a file was read: by a model reading the document, or from a
// spreadsheet's columns, whose mapping was saved already (hit), made now
// (miss) or not needed (none); how many of its rows made no holding; and how
// many rows and figures the document's two readings disagreed on, which a
// third settled (0 for a spreadsheet).
export type SourceReadInfo = {
  reader: "document" | "sheet";
  mapping: "none" | "hit" | "miss";
  skippedRows: number;
  disputes: number;
};

export type SourceReading = { draft: ImportDraft; read: SourceReadInfo };

// One way of reading a connection's holdings. `capabilities` is local and
// never fails; `read` throws a SourceError when it cannot read.
export interface PortfolioSourcePort {
  readonly kind: SourceKind;
  capabilities(): SourceCapabilities;
  read(input: SourceInput): Promise<SourceReading>;
}

// Builds each kind's adapter; the composition root supplies them, with
// whatever reads files or calls an API.
export type SourceAdapters = {
  [K in SourceKind]: () => PortfolioSourcePort;
};

// The one way to get a connection's source.
export function createSourceForConnection(
  connection: { kind: SourceKind },
  adapters: SourceAdapters,
): PortfolioSourcePort {
  return adapters[connection.kind]();
}
