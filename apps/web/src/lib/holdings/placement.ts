import { holdingDateSchema, MAX_ANNUAL_RATE } from "@plant/core";
import { compareDecimals } from "@plant/shared";
import { z } from "zod";

// What a placement at a rate is, as the user names it. The class is the same
// (fixed_term) and so is its valuation.
export const PLACEMENT_KINDS = [
  "fixed_term",
  "caucion",
  "loan",
  "other",
] as const;
export type PlacementKind = (typeof PLACEMENT_KINDS)[number];

export const PLACEMENT_KIND_LABELS: Record<PlacementKind, string> = {
  fixed_term: "Plazo fijo",
  caucion: "Caución",
  loan: "Préstamo otorgado",
  other: "Otra colocación",
};

// A renewal's new term: from a day on, to a later one, at a nominal rate.
export const renewalInputSchema = z
  .object({
    started_on: holdingDateSchema,
    matures_on: holdingDateSchema,
    annual_rate: z
      .string()
      .regex(/^\d+(\.\d+)?$/)
      .refine((rate) => compareDecimals(rate, MAX_ANNUAL_RATE) <= 0),
  })
  .strict()
  .refine((term) => term.matures_on > term.started_on, {
    message: "A term ends after it starts",
    path: ["matures_on"],
  });
export type RenewalInput = z.infer<typeof renewalInputSchema>;
