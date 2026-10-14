import { z } from "zod";

import type {
  DraftDebt,
  DraftOperation,
  ImportDraft,
} from "./file-upload/draft";

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
  // No retry follows this attempt, so a reader settles for what it has
  // rather than failing on a provider that may answer later.
  lastAttempt: boolean;
};

// What a document is, as its reading tells: an account's statement of
// holdings, a trade ticket, a list of operations, a screenshot of holdings, a
// card statement, or something else.
export const documentKindSchema = z.enum([
  "account_statement",
  "trade_ticket",
  "operations_list",
  "screenshot",
  "card_statement",
  "other",
]);
export type DocumentKind = z.infer<typeof documentKindSchema>;

// The kinds of document whose reading is operations, not holdings.
export const OPERATION_DOCUMENT_KINDS: readonly DocumentKind[] = [
  "trade_ticket",
  "operations_list",
];

// The kinds of document whose reading is debts.
export const DEBT_DOCUMENT_KINDS: readonly DocumentKind[] = ["card_statement"];

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
  // What the document's readings agreed it is; null for a spreadsheet or
  // when they did not agree.
  documentKind: DocumentKind | null;
};

// What a read yields: the holdings a document lists, the operations a
// document of operations shows, or what a card statement says is owed.
export type HoldingsReading = { draft: ImportDraft; read: SourceReadInfo };
export type OperationsReading = {
  operations: DraftOperation[];
  read: SourceReadInfo;
};
export type DebtsReading = { debts: DraftDebt[]; read: SourceReadInfo };
export type SourceReading = HoldingsReading | OperationsReading | DebtsReading;

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
