import { z } from "zod";

export const currencySchema = z.enum(["ARS", "USD"]);
export type Currency = z.infer<typeof currencySchema>;

// Amounts travel as decimal strings so no layer rounds them through a float.
// Postgres stores them as numeric.
export const decimalStringSchema = z
  .string()
  .regex(/^-?\d+(\.\d+)?$/, "Debe ser un número decimal, por ejemplo 1234.56");

export const moneySchema = z.object({
  amount: decimalStringSchema,
  currency: currencySchema,
});
export type Money = z.infer<typeof moneySchema>;
