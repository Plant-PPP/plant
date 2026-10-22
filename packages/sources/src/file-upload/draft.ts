import {
  Constants,
  currencySchema,
  compareDecimals,
  decimalStringSchema,
  LOCAL_SYMBOL_PATTERN,
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
// and the page it is on. Only cash may be at zero: a balance listed at zero,
// which brings the account's cash in that currency to zero.
export const draftRowSchema = z
  .object({
    symbol: z.string().trim().min(1).max(30),
    quantity: nonNegativeDecimalSchema,
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
  .strict()
  .refine(
    (row) =>
      row.assetClass === "cash" ||
      positiveDecimalSchema.safeParse(row.quantity).success,
    { path: ["quantity"], message: "Must be greater than 0" },
  );

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

// The operations a document of operations may show. An adjustment is units
// that came in from outside the account without a trade: a crypto deposit
// from a wallet, or a loan's disbursement.
export const OPERATION_KINDS = [
  "purchase",
  "sale",
  "dividend",
  "coupon",
  "adjustment",
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

// The kinds of movement a broker's statement of an account's money lists.
export const ACCOUNT_MOVEMENT_KINDS = [
  "purchase",
  "sale",
  "dividend",
  "deposit",
  "withdrawal",
  "credit",
] as const;

// One account side of a movement of its money, as a broker's statement lists
// it: its number, kind, the instrument as the statement names it, the day,
// the units, price, commission, VAT on it and other taxes, the signed amount
// the account moved, and the account's currency. A credit is any other
// movement of the cash (interest, a fee, a tax withheld), by its sign.
export const accountMovementRowSchema = z
  .object({
    number: z.string().trim().min(1).max(40),
    kind: z.enum(ACCOUNT_MOVEMENT_KINDS),
    symbol: z.string().trim().min(1).max(30).nullable(),
    date: z.iso.date(),
    quantity: positiveDecimalSchema.nullable(),
    price: positiveDecimalSchema.nullable(),
    commission: nonNegativeDecimalSchema,
    vat: nonNegativeDecimalSchema,
    otherTaxes: nonNegativeDecimalSchema,
    amount: decimalStringSchema,
    currency: currencySchema,
  })
  .strict();

// The most movements of cash one sync keeps.
export const CASH_DRAFT_ROW_LIMIT = 2000;

// What a sync of operations read of the account's money: its movements, and
// the balance each currency had on the first day read, when the provider
// says.
export const cashDraftSchema = z
  .object({
    rows: z.array(accountMovementRowSchema).max(CASH_DRAFT_ROW_LIMIT),
    openings: z
      .array(
        z
          .object({
            currency: currencySchema,
            date: z.iso.date(),
            amount: nonNegativeDecimalSchema,
          })
          .strict(),
      )
      .max(Constants.public.Enums.currency.length),
  })
  .strict();

// What a card statement says is owed in one currency. Whatever it does not
// print, or the readings disagreed on, is null for the review to ask: the
// card's name, the bank that issued it, the statement's balance, its minimum
// payment and its due date.
// A debt as a card, loan or credit line statement shows it. A null kind is a
// card; a crypto loan is owed in units of `instrumentSymbol`, with no
// currency. The rate is a yearly fraction.
export const draftDebtSchema = z
  .object({
    kind: z
      .enum(Constants.public.Enums.liability_kind)
      .nullable()
      .default(null),
    label: z.string().trim().min(1).max(60).nullable(),
    lender: z.string().trim().min(1).max(60).nullable(),
    currency: currencySchema.nullable(),
    instrumentSymbol: z
      .string()
      .regex(LOCAL_SYMBOL_PATTERN)
      .nullable()
      .default(null),
    balance: positiveDecimalSchema.nullable(),
    minimumPayment: positiveDecimalSchema.nullable(),
    dueDate: z.iso.date().nullable(),
    annualRate: nonNegativeDecimalSchema
      .refine((rate) => compareDecimals(rate, "10") <= 0)
      .nullable()
      .default(null),
    accrues: z.boolean().nullable().default(null),
    openedOn: z.iso.date().nullable().default(null),
    confidence: importConfidenceSchema,
    page: z.number().int().min(1).max(10000).nullable(),
  })
  .strict()
  .refine((debt) => debt.currency !== null || debt.kind === "crypto_loan", {
    path: ["currency"],
  });

// A statement owes at most one balance per currency it bills in, or a few
// loans.
export const DRAFT_DEBT_LIMIT = 10;

export type AccountMovementRow = z.infer<typeof accountMovementRowSchema>;
export type CashDraft = z.infer<typeof cashDraftSchema>;
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
