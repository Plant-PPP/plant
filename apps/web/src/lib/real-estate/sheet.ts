import {
  holdingDateSchema,
  type Liability,
  type RealEstateTerms,
} from "@plant/core";
import {
  type Currency,
  currencySchema,
  exactOf,
  positiveDecimalSchema,
} from "@plant/shared";
import { z } from "zod";

// A property's sheet: what it is, what it cost, what it brings in and costs
// each month, how the rent is adjusted, and how it was paid. Each amount
// carries its currency; the rent's adjustment is information only.
export const PROPERTY_KINDS = [
  "home",
  "rented",
  "commercial",
  "land",
  "off_plan",
] as const;
export type PropertyKind = (typeof PROPERTY_KINDS)[number];

export const PROPERTY_KIND_LABELS: Record<PropertyKind, string> = {
  home: "Vivienda",
  rented: "Alquilada",
  commercial: "Local",
  land: "Terreno",
  off_plan: "En pozo",
};

export const RENT_INDEXES = ["icl", "ipc", "fixed"] as const;
export type RentIndex = (typeof RENT_INDEXES)[number];

export const RENT_INDEX_LABELS: Record<RentIndex, string> = {
  icl: "ICL",
  ipc: "IPC",
  fixed: "Fijo",
};

export const PAYMENTS = ["cash", "mortgage", "installments"] as const;
export type Payment = (typeof PAYMENTS)[number];

export const PAYMENT_LABELS: Record<Payment, string> = {
  cash: "Contado",
  mortgage: "Hipoteca",
  installments: "Cuotas",
};

const money = z
  .object({ amount: positiveDecimalSchema, currency: currencySchema })
  .strict();

export const realEstateSheetSchema = z
  .object({
    kind: z.enum(PROPERTY_KINDS),
    purchase: money.extend({ date: holdingDateSchema }).strict().nullable(),
    monthlyRent: money.nullable(),
    monthlyExpenses: money.nullable(),
    adjustment: z
      .object({
        index: z.enum(RENT_INDEXES),
        everyMonths: z.number().int().min(1).max(60),
      })
      .strict()
      .nullable(),
    payment: z.enum(PAYMENTS),
    // The debt a mortgage or installments are, among the user's debts.
    liabilityId: z.string().min(1).nullable(),
  })
  .strict()
  // Paid in cash, no debt; financed, one debt.
  .refine(
    (sheet) => (sheet.payment === "cash") === (sheet.liabilityId === null),
    {
      message: "A financed property names its debt, and only then",
      path: ["liabilityId"],
    },
  );
export type RealEstateSheet = z.infer<typeof realEstateSheetSchema>;

// What core's figures take: the property's value, the sheet's amounts, and
// the debt it was paid with, if it was financed and the debt is still there.
export function sheetTerms(
  property: { amount: string; currency: Currency },
  sheet: RealEstateSheet,
  debt:
    | Pick<Liability, "currency" | "uva" | "instrument_symbol" | "installment">
    | undefined,
): RealEstateTerms {
  const money = (stated: { amount: string; currency: Currency } | null) =>
    stated && { amount: exactOf(stated.amount), currency: stated.currency };
  return {
    value: money(property)!,
    purchase: money(sheet.purchase),
    monthlyRent: money(sheet.monthlyRent),
    monthlyExpenses: money(sheet.monthlyExpenses),
    debt: sheet.payment === "cash" ? null : (debt ?? null),
  };
}
