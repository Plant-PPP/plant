import {
  Constants,
  currencySchema,
  nonNegativeDecimalSchema,
  positiveDecimalSchema,
} from "@plant/shared";
import { z } from "zod";

// How sure a reading is of one row; a low one is for the user to check.
export const importConfidenceSchema = z.enum(
  Constants.public.Enums.import_confidence,
);

// What a draft row holds: an instrument or cash, as the database names them.
export const draftAssetClassSchema = z
  .enum(Constants.public.Enums.asset_class)
  .extract(["instrument", "cash"]);

// The most rows one document yields; past it the document is not a statement.
export const DRAFT_ROW_LIMIT = 500;

// One holding as the document lists it: the instrument as it names it, how
// many, the price per unit and the holding's value it prints in its currency,
// and the page it is on.
export const draftRowSchema = z
  .object({
    symbol: z.string().trim().min(1).max(30),
    quantity: positiveDecimalSchema,
    price: positiveDecimalSchema.nullable(),
    value: positiveDecimalSchema.nullable(),
    // The average cost per unit it prints, a bond's per 100 nominal.
    cost: positiveDecimalSchema.nullable().optional(),
    // The account it lists the holding under, when it lists several.
    account: z.string().trim().min(1).max(60).optional(),
    // Cash is a balance in `currency`, its quantity the amount and its symbol
    // the currency's code; a row without it is an instrument.
    assetClass: draftAssetClassSchema.optional(),
    currency: currencySchema,
    confidence: importConfidenceSchema,
    page: z.number().int().min(1).max(10000).nullable(),
  })
  .strict();

// What a file yields: the date its holdings are at, when it prints one, its
// rows, and the holdings totals it prints, at most one per currency.
export const importDraftSchema = z
  .object({
    documentDate: z.iso.date().nullable(),
    rows: z.array(draftRowSchema).max(DRAFT_ROW_LIMIT),
    totals: z
      .array(
        z
          .object({
            currency: currencySchema,
            amount: nonNegativeDecimalSchema,
          })
          .strict(),
      )
      .max(Constants.public.Enums.currency.length)
      .refine(
        (totals) =>
          new Set(totals.map((total) => total.currency)).size === totals.length,
        "One total per currency",
      ),
  })
  .strict();

// The operations a document of operations may show.
export const OPERATION_KINDS = [
  "purchase",
  "sale",
  "dividend",
  "coupon",
] as const;

// One operation as the document shows it. Whatever it does not print, or the
// readings disagreed on, is null for the review to ask: the instrument as it
// names it, the units, the price as printed (a bond's per 100 nominal), a
// dividend's or coupon's amount or a trade's printed total, its charges added
// up, and its transaction number.
export const draftOperationSchema = z
  .object({
    date: z.iso.date().nullable(),
    kind: z.enum(OPERATION_KINDS).nullable(),
    symbol: z.string().trim().min(1).max(30).nullable(),
    quantity: positiveDecimalSchema.nullable(),
    price: positiveDecimalSchema.nullable(),
    amount: positiveDecimalSchema.nullable(),
    charges: nonNegativeDecimalSchema.nullable(),
    reference: z.string().trim().min(1).max(40).nullable(),
    currency: currencySchema,
    confidence: importConfidenceSchema,
    page: z.number().int().min(1).max(10000).nullable(),
  })
  .strict();

// What a card statement says is owed in one currency. Whatever it does not
// print, or the readings disagreed on, is null for the review to ask: the
// card's name, the bank that issued it, the statement's balance, its minimum
// payment and its due date.
export const draftDebtSchema = z
  .object({
    label: z.string().trim().min(1).max(60).nullable(),
    lender: z.string().trim().min(1).max(60).nullable(),
    currency: currencySchema,
    balance: positiveDecimalSchema.nullable(),
    minimumPayment: positiveDecimalSchema.nullable(),
    dueDate: z.iso.date().nullable(),
    confidence: importConfidenceSchema,
    page: z.number().int().min(1).max(10000).nullable(),
  })
  .strict();

// A card statement owes at most one balance per currency it bills in.
export const DRAFT_DEBT_LIMIT = 10;

export type DraftDebt = z.infer<typeof draftDebtSchema>;
export type DraftOperation = z.infer<typeof draftOperationSchema>;
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
