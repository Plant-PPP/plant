import type { Currency } from "@plant/shared";

import { amountInput, parseAmountInput } from "@/lib/format/amount";
import {
  type Payment,
  type PropertyKind,
  type RealEstateSheet,
  realEstateSheetSchema,
  type RentIndex,
} from "@/lib/real-estate/sheet";

// The sheet's fields, as typed. An amount left empty is one the property does
// not have.
export type SheetFields = {
  kind: PropertyKind;
  purchasePrice: string;
  purchaseCurrency: Currency;
  purchaseDate: string;
  rent: string;
  rentCurrency: Currency;
  expenses: string;
  expensesCurrency: Currency;
  index: RentIndex | "none";
  everyMonths: string;
  payment: Payment;
  liabilityId: string;
};

export type SheetField =
  | "purchasePrice"
  | "purchaseDate"
  | "rent"
  | "expenses"
  | "everyMonths"
  | "liabilityId";

export const SHEET_MESSAGES: Record<SheetField, string> = {
  purchasePrice:
    "Ingresá el precio de compra con coma para los decimales, o dejalo vacío.",
  purchaseDate: "Elegí la fecha de compra.",
  rent: "Ingresá el alquiler con coma para los decimales, o dejalo vacío.",
  expenses: "Ingresá los gastos con coma para los decimales, o dejalos vacíos.",
  everyMonths: "El ajuste va cada 1 a 60 meses.",
  liabilityId: "Elegí la deuda con la que la pagás.",
};

// A sheet's fields, or a new one's: a home in the property's currency, paid
// in cash.
export function sheetFields(
  sheet: RealEstateSheet | undefined,
  { currency, today }: { currency: Currency; today: string },
): SheetFields {
  return {
    kind: sheet?.kind ?? "home",
    purchasePrice: sheet?.purchase ? amountInput(sheet.purchase.amount) : "",
    purchaseCurrency: sheet?.purchase?.currency ?? currency,
    purchaseDate: sheet?.purchase?.date ?? today,
    rent: sheet?.monthlyRent ? amountInput(sheet.monthlyRent.amount) : "",
    rentCurrency: sheet?.monthlyRent?.currency ?? "ARS",
    expenses: sheet?.monthlyExpenses
      ? amountInput(sheet.monthlyExpenses.amount)
      : "",
    expensesCurrency: sheet?.monthlyExpenses?.currency ?? "ARS",
    index: sheet?.adjustment?.index ?? "none",
    everyMonths: String(sheet?.adjustment?.everyMonths ?? 12),
    payment: sheet?.payment ?? "cash",
    liabilityId: sheet?.liabilityId ?? "",
  };
}

// The sheet the fields describe, or the first field it cannot take.
export function toSheet(
  fields: SheetFields,
): { sheet: RealEstateSheet } | { refused: SheetField } {
  // An empty amount is none; one typed must parse.
  const amount = (typed: string): string | null | undefined =>
    typed.trim() === "" ? null : (parseAmountInput(typed) ?? undefined);
  const purchase = amount(fields.purchasePrice);
  if (purchase === undefined) return { refused: "purchasePrice" };
  if (purchase !== null && fields.purchaseDate === "") {
    return { refused: "purchaseDate" };
  }
  const rent = amount(fields.rent);
  if (rent === undefined) return { refused: "rent" };
  const expenses = amount(fields.expenses);
  if (expenses === undefined) return { refused: "expenses" };
  const everyMonths = Number(fields.everyMonths);
  if (
    fields.index !== "none" &&
    !(Number.isInteger(everyMonths) && everyMonths >= 1 && everyMonths <= 60)
  ) {
    return { refused: "everyMonths" };
  }
  const financed = fields.payment !== "cash";
  if (financed && fields.liabilityId === "") return { refused: "liabilityId" };
  const parsed = realEstateSheetSchema.safeParse({
    kind: fields.kind,
    purchase:
      purchase === null
        ? null
        : {
            amount: purchase,
            currency: fields.purchaseCurrency,
            date: fields.purchaseDate,
          },
    monthlyRent:
      rent === null ? null : { amount: rent, currency: fields.rentCurrency },
    monthlyExpenses:
      expenses === null
        ? null
        : { amount: expenses, currency: fields.expensesCurrency },
    adjustment:
      fields.index === "none" ? null : { index: fields.index, everyMonths },
    payment: fields.payment,
    liabilityId: financed ? fields.liabilityId : null,
  });
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    return {
      refused:
        field === "purchase"
          ? "purchasePrice"
          : field === "monthlyRent"
            ? "rent"
            : field === "monthlyExpenses"
              ? "expenses"
              : "liabilityId",
    };
  }
  return { sheet: parsed.data };
}
