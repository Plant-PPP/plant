import { z } from "zod";

import { Constants } from "./db/generated/database.types";

export const currencySchema = z.enum(Constants.public.Enums.currency);
export type Currency = z.infer<typeof currencySchema>;

// Amounts travel as decimal strings so no layer rounds them through a float.
// Postgres stores them as numeric(20, 8): up to 12 integer digits and 8
// decimals. Trailing zeros are allowed ("1.5" and "1.50"; Postgres returns the
// column padded to 8 decimals), so amounts are compared as decimals, never as
// strings.
export const decimalStringSchema = z
  .string()
  .regex(
    /^-?(0|[1-9]\d{0,11})(\.\d{1,8})?$/,
    "Must be a decimal number, e.g. 1234.56",
  )
  .refine((value) => !/^-0(\.0+)?$/.test(value), "Use 0 instead of -0");

export const positiveDecimalSchema = decimalStringSchema.refine(
  (value) => !/^(-|0(\.0+)?$)/.test(value),
  "Must be greater than 0",
);

export const DECIMAL_SCALE_DIGITS = 8;
export const DECIMAL_SCALE = 10n ** BigInt(DECIMAL_SCALE_DIGITS);

// A decimal string as an integer count of 10^-8 units, exact for every value
// decimalStringSchema accepts.
export function toScaled(decimal: string): bigint {
  const negative = decimal.startsWith("-");
  const [whole = "0", fraction = ""] = (
    negative ? decimal.slice(1) : decimal
  ).split(".");
  const scaled =
    BigInt(whole) * DECIMAL_SCALE +
    BigInt(fraction.padEnd(DECIMAL_SCALE_DIGITS, "0"));
  return negative ? -scaled : scaled;
}

export function compareDecimals(a: string, b: string): number {
  const difference = toScaled(a) - toScaled(b);
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}

export const moneySchema = z.object({
  amount: decimalStringSchema,
  currency: currencySchema,
});
export type Money = z.infer<typeof moneySchema>;
