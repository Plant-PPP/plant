import {
  Constants,
  currencySchema,
  positiveDecimalSchema,
} from "@plant/shared";
import { z } from "zod";

// How sure a reading is of one row; a low one is for the user to check.
export const importConfidenceSchema = z.enum(
  Constants.public.Enums.import_confidence,
);

// The most rows one document yields; past it the document is not a statement.
export const DRAFT_ROW_LIMIT = 500;

// One holding as the document lists it: the instrument as it names it, how
// many, the price per unit it prints in its currency, and the page it is on.
export const draftRowSchema = z
  .object({
    symbol: z.string().trim().min(1).max(30),
    quantity: positiveDecimalSchema,
    price: positiveDecimalSchema.nullable(),
    currency: currencySchema,
    confidence: importConfidenceSchema,
    page: z.number().int().min(1).max(10000).nullable(),
  })
  .strict();

// What a file yields: the date its holdings are at, when it prints one, and
// its rows.
export const importDraftSchema = z
  .object({
    documentDate: z.iso.date().nullable(),
    rows: z.array(draftRowSchema).max(DRAFT_ROW_LIMIT),
  })
  .strict();

export type DraftRow = z.infer<typeof draftRowSchema>;
export type ImportDraft = z.infer<typeof importDraftSchema>;

// Why a file could not be read, as `imports.failure` records it: a type the
// reader does not take yet, a file it cannot open, one with no holdings, or a
// reading that failed.
export type SourceErrorCode =
  (typeof Constants.public.Enums.import_failure)[number];

// The one error a source throws. A retryable one may pass on a later attempt
// (a provider down or rate limiting); any other ends the import.
export class SourceError extends Error {
  override readonly name = "SourceError";
  constructor(
    readonly code: SourceErrorCode,
    readonly retryable: boolean,
    options?: { cause?: unknown },
  ) {
    super(`source failed: ${code}`, options);
  }
}
