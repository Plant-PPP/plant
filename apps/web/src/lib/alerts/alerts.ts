import type { QuoteSnapshot } from "@plant/core";
import {
  compareDecimals,
  type Currency,
  exactOf,
  INSTRUMENT_SYMBOL_PATTERN,
  minus,
  over,
  positiveDecimalSchema,
  stored,
} from "@plant/shared";
import { z } from "zod";

import {
  formatAmount,
  formatFraction,
  formatQuantity,
} from "@/lib/format/amount";
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
// it, and when it was met and seen. A gain alert has its percent and the
// average cost its figure follows, both none while the cost is unknown.
export type PriceAlert = {
  id: string;
  subjectKind: "instrument" | "dollar";
  subject: string;
  direction: "above" | "below";
  threshold: string | null;
  currency: Currency;
  gainPercent: string | null;
  costPrice: string | null;
  metOn: string | null;
  metPrice: string | null;
  seenAt: string | null;
};

// How setting an alert went, for the form's message.
export type AlertWriteResult =
  "ok" | "invalid" | "full" | "unknown_instrument" | "failed";

// The most alerts a user keeps.
export const MAX_ALERTS = 50;

// A price above zero that numeric(20, 8) holds.
const positiveDecimal = positiveDecimalSchema.and(
  z.string().regex(/^\d{1,12}(\.\d{1,8})?$/),
);

// A gain's percent as numeric(9, 4) holds it; a loss is under 100.
const gainPercent = positiveDecimalSchema.and(
  z.string().regex(/^\d{1,4}(\.\d{1,4})?$/),
);

// A new alert as the form sends it. A dollar's is in pesos; a gain alert's
// currency is its instrument's, and its figure the server works out.
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
        subject: z.string().regex(INSTRUMENT_SYMBOL_PATTERN),
        direction: z.enum(["above", "below"]),
        threshold: positiveDecimal,
        currency: z.enum(["ARS", "USD"]),
      })
      .strict(),
    z
      .object({
        subjectKind: z.literal("gain"),
        subject: z.string().regex(INSTRUMENT_SYMBOL_PATTERN),
        direction: z.enum(["above", "below"]),
        percent: gainPercent,
      })
      .strict()
      .refine(
        ({ direction, percent }) =>
          direction === "above" || compareDecimals(percent, "100") < 0,
      ),
  ])
  .readonly();
export type NewAlert = z.infer<typeof newAlertSchema>;

// An instrument's alert from its page's form: on its price in its own
// currency, or on its gain or loss in percent; null when the figure does not
// read as one.
export function instrumentAlert(
  kind: "price" | "gain",
  instrument: { symbol: string; currency: "ARS" | "USD" },
  direction: "above" | "below",
  figure: string | null,
): NewAlert | null {
  if (figure === null) return null;
  const parsed = newAlertSchema.safeParse(
    kind === "gain"
      ? {
          subjectKind: "gain",
          subject: instrument.symbol,
          direction,
          percent: figure,
        }
      : {
          subjectKind: "instrument",
          subject: instrument.symbol,
          direction,
          threshold: figure,
          currency: instrument.currency,
        },
  );
  return parsed.success ? parsed.data : null;
}

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
  if (alert.gainPercent !== null) return gainLine(alert, alert.gainPercent);
  const threshold = formatAmount(alert.threshold!, alert.currency);
  const above = alert.direction === "above";
  if (alert.metOn === null || alert.metPrice === null) {
    return `Cuando ${subjectOf(alert, false)} ${above ? "llegue a" : "baje a"} ${threshold}`;
  }
  return `${subjectOf(alert, true)} ${above ? "llegó a" : "bajó a"} ${formatAmount(alert.metPrice, alert.currency)} el ${formatDate(alert.metOn)} (tu alerta: ${threshold})`;
}

// A gain alert's line: "Cuando AL30 gane un 20 % sobre tu costo promedio de
// US$ 52,30 (a US$ 62,76)", or what met it.
function gainLine(alert: PriceAlert, percent: string): string {
  const above = alert.direction === "above";
  const asked = `${formatQuantity(percent)} %`;
  const cost =
    alert.costPrice === null
      ? null
      : formatAmount(alert.costPrice, alert.currency);
  if (alert.metOn === null || alert.metPrice === null) {
    const target =
      cost === null || alert.threshold === null
        ? "tu costo promedio, cuando lo podamos calcular con tus movimientos"
        : `tu costo promedio de ${cost} (a ${formatAmount(alert.threshold, alert.currency)})`;
    return `Cuando ${alert.subject} ${above ? "gane" : "pierda"} un ${asked} sobre ${target}`;
  }
  const change =
    alert.costPrice === null
      ? null
      : stored(
          over(
            minus(exactOf(alert.metPrice), exactOf(alert.costPrice)),
            exactOf(alert.costPrice),
          ),
        );
  const moved =
    change === null
      ? ""
      : `: ${compareDecimals(change, "0") >= 0 ? "gana" : "pierde"} un ${formatFraction(change.replace(/^-/, ""))} sobre tu costo promedio de ${cost}`;
  return `${alert.subject} llegó a ${formatAmount(alert.metPrice, alert.currency)} el ${formatDate(alert.metOn)}${moved} (tu alerta: ${above ? "+" : "−"}${asked})`;
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

// Whether a price meets an alert, as the prototype checks it in place of the
// quotes job; one with no figure yet is not met.
export const meets = (
  alert: Pick<PriceAlert, "direction" | "threshold">,
  price: string,
): boolean =>
  alert.threshold !== null &&
  (alert.direction === "above"
    ? compareDecimals(price, alert.threshold) >= 0
    : compareDecimals(price, alert.threshold) <= 0);
