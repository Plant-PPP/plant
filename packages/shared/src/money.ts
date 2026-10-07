import { z } from "zod";

export const currencySchema = z.enum(["ARS", "USD"]);
export type Currency = z.infer<typeof currencySchema>;

// Amounts travel as decimal strings so no layer rounds them through a float.
// Postgres stores them as numeric(20, 8): up to 12 integer digits and 8
// decimals. One canonical spelling per value (no leading zeros, no "-0"), so
// two equal amounts compare equal as strings.
export const decimalStringSchema = z
  .string()
  .regex(
    /^-?(0|[1-9]\d{0,11})(\.\d{1,8})?$/,
    "Debe ser un número decimal, por ejemplo 1234.56",
  )
  .refine((value) => !/^-0(\.0+)?$/.test(value), "Usá 0 en lugar de -0");

export const moneySchema = z.object({
  amount: decimalStringSchema,
  currency: currencySchema,
});
export type Money = z.infer<typeof moneySchema>;
