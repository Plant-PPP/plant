import type { QuoteSnapshot } from "@plant/core";
import {
  compareDecimals,
  type Currency,
  positiveDecimalSchema,
} from "@plant/shared";
import { z } from "zod";

import { formatAmount } from "@/lib/format/amount";
import { formatDate } from "@/lib/format/date";
import { inSentence } from "@/lib/format/text";

export const ALERT_DOLLARS = ["mep", "ccl", "official", "blue"] as const;
export type AlertDollar = (typeof ALERT_DOLLARS)[number];

export const ALERT_DOLLAR_LABELS: Record<AlertDollar, string> = {
  mep: "Dólar MEP",
  ccl: "Dólar CCL",
  official: "Dólar oficial",
  blue: "Dólar blue",
};

// A price alert as the pages show it: what it watches, the figure that meets
// it, and when it was met and seen.
export type PriceAlert = {
  id: string;
  subjectKind: "instrument" | "dollar";
  subject: string;
  direction: "above" | "below";
  threshold: string;
  currency: Currency;
  metOn: string | null;
  metPrice: string | null;
  seenAt: string | null;
};

// The most alerts a user keeps.
export const MAX_ALERTS = 50;

// A price above zero that numeric(20, 8) holds.
const positiveDecimal = positiveDecimalSchema.and(
  z.string().regex(/^\d{1,12}(\.\d{1,8})?$/),
);

// A new alert as the form sends it. A dollar's is in pesos.
export const newAlertSchema = z
  .discriminatedUnion("subjectKind", [
    z
      .object({
        subjectKind: z.literal("dollar"),
        subject: z.enum(ALERT_DOLLARS),
        direction: z.enum(["above", "below"]),
        threshold: positiveDecimal,
        currency: z.literal("ARS"),
      })
      .strict(),
    z
      .object({
        subjectKind: z.literal("instrument"),
        subject: z.string().regex(/^[A-Z0-9]{1,15}$/),
        direction: z.enum(["above", "below"]),
        threshold: positiveDecimal,
        currency: z.enum(["ARS", "USD"]),
      })
      .strict(),
  ])
  .readonly();
export type NewAlert = z.infer<typeof newAlertSchema>;

// What an alert watches, inside a sentence or starting it: "el dólar MEP",
// "El dólar MEP", "AL30".
const subjectOf = (
  alert: Pick<PriceAlert, "subjectKind" | "subject">,
  starts: boolean,
) =>
  alert.subjectKind === "dollar"
    ? `${starts ? "El" : "el"} ${inSentence(ALERT_DOLLAR_LABELS[alert.subject as AlertDollar] ?? alert.subject)}`
    : alert.subject;

// What an alert waits for, or what met it: "El dólar MEP llegó a $ 1.412,50
// el 14/10/2026 (tu alerta: $ 1.400,00)".
export function alertLine(alert: PriceAlert): string {
  const threshold = formatAmount(alert.threshold, alert.currency);
  const above = alert.direction === "above";
  if (alert.metOn === null || alert.metPrice === null) {
    return `Cuando ${subjectOf(alert, false)} ${above ? "llegue a" : "baje a"} ${threshold}`;
  }
  return `${subjectOf(alert, true)} ${above ? "llegó a" : "bajó a"} ${formatAmount(alert.metPrice, alert.currency)} el ${formatDate(alert.metOn)} (tu alerta: ${threshold})`;
}

// The latest quote of what an alert watches in its currency, from a snapshot;
// null when the snapshot has none.
export function alertQuote(
  alert: Pick<PriceAlert, "subjectKind" | "subject" | "currency">,
  snapshot: QuoteSnapshot,
): { price: string; date: string } | null {
  if (alert.subjectKind === "dollar") {
    const rate = snapshot.fx[alert.subject as AlertDollar];
    return rate ? { price: rate.sell, date: rate.date } : null;
  }
  const quote = snapshot.prices[alert.subject];
  return quote && quote.currency === alert.currency
    ? { price: quote.price, date: quote.date }
    : null;
}

// Whether a price meets an alert, as the quotes job checks it.
export const meets = (
  alert: Pick<PriceAlert, "direction" | "threshold">,
  price: string,
): boolean =>
  alert.direction === "above"
    ? compareDecimals(price, alert.threshold) >= 0
    : compareDecimals(price, alert.threshold) <= 0;
