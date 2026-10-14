import type { QuoteSnapshot } from "@plant/core";

import {
  alertLine,
  alertQuote,
  meets,
  newAlertSchema,
  type PriceAlert,
} from "./alerts";

const waiting = (overrides: Partial<PriceAlert> = {}): PriceAlert => ({
  id: "a",
  subjectKind: "dollar",
  subject: "mep",
  direction: "above",
  threshold: "1400",
  currency: "ARS",
  gainPercent: null,
  costPrice: null,
  metOn: null,
  metPrice: null,
  seenAt: null,
  ...overrides,
});

const snapshot: QuoteSnapshot = {
  date: "2026-10-14",
  fx: { mep: { sell: "1412.5", date: "2026-10-14" } },
  prices: { AL30: { price: "62.1", currency: "USD", date: "2026-10-13" } },
};

it("meets an alert at its figure and past it, never short of it", () => {
  expect(meets(waiting(), "1400")).toBe(true);
  expect(meets(waiting(), "1400.01")).toBe(true);
  expect(meets(waiting(), "1399.99")).toBe(false);
  expect(meets(waiting({ direction: "below" }), "1399.99")).toBe(true);
  expect(meets(waiting({ direction: "below" }), "1400.01")).toBe(false);
});

it("reads a dollar's sell rate and an instrument's price only in the alert's currency", () => {
  expect(alertQuote(waiting(), snapshot)).toEqual({
    price: "1412.5",
    date: "2026-10-14",
  });
  const al30 = waiting({ subjectKind: "instrument", subject: "AL30" });
  expect(alertQuote({ ...al30, currency: "USD" }, snapshot)).toEqual({
    price: "62.1",
    date: "2026-10-13",
  });
  expect(alertQuote({ ...al30, currency: "ARS" }, snapshot)).toBeNull();
  expect(alertQuote(waiting({ subject: "blue" }), snapshot)).toBeNull();
});

it("says what an alert waits for and what met it", () => {
  expect(alertLine(waiting())).toBe("Cuando el dólar MEP llegue a $ 1.400,00");
  expect(
    alertLine(
      waiting({
        subjectKind: "instrument",
        subject: "AL30",
        direction: "below",
        threshold: "60",
        currency: "USD",
        metOn: "2026-10-14",
        metPrice: "59.5",
      }),
    ),
  ).toBe("AL30 bajó a US$ 59,50 el 14/10/2026 (tu alerta: US$ 60,00)");
});

it("takes a new alert only as the form sends it", () => {
  const dollar = {
    subjectKind: "dollar",
    subject: "mep",
    direction: "above",
    threshold: "1400.5",
    currency: "ARS",
  };
  expect(newAlertSchema.safeParse(dollar).success).toBe(true);
  for (const bad of [
    { ...dollar, currency: "USD" },
    { ...dollar, subject: "uva" },
    { ...dollar, threshold: "0" },
    { ...dollar, threshold: "-1" },
    { ...dollar, threshold: "1,5" },
    { ...dollar, subjectKind: "instrument", subject: "al30" },
    { ...dollar, user_id: "someone" },
  ]) {
    expect(newAlertSchema.safeParse(bad).success).toBe(false);
  }
});

it("says what a gain alert waits for and what met it", () => {
  const gain = waiting({
    subjectKind: "instrument",
    subject: "BTC",
    currency: "USD",
    threshold: "60000",
    gainPercent: "20",
    costPrice: "50000",
  });
  expect(alertLine(gain)).toBe(
    "Cuando BTC gane un 20 % sobre tu costo promedio de US$ 50.000,00 (a US$ 60.000,00)",
  );
  expect(alertLine({ ...gain, threshold: null, costPrice: null })).toBe(
    "Cuando BTC gane un 20 % sobre tu costo promedio, cuando lo podamos calcular con tus movimientos",
  );
  expect(alertLine({ ...gain, metOn: "2026-10-14", metPrice: "61000" })).toBe(
    "BTC llegó a US$ 61.000,00 el 14/10/2026: gana un 22,0 % sobre tu costo promedio de US$ 50.000,00 (tu alerta: +20 %)",
  );
});

it("takes a gain alert with a percent, and a loss under 100 %", () => {
  const gain = {
    subjectKind: "gain",
    subject: "BTC",
    direction: "above",
    percent: "250",
  };
  expect(newAlertSchema.safeParse(gain).success).toBe(true);
  expect(
    newAlertSchema.safeParse({ ...gain, direction: "below", percent: "30" })
      .success,
  ).toBe(true);
  expect(
    newAlertSchema.safeParse({ ...gain, direction: "below", percent: "100" })
      .success,
  ).toBe(false);
  expect(newAlertSchema.safeParse({ ...gain, percent: "0" }).success).toBe(
    false,
  );
  expect(newAlertSchema.safeParse({ ...gain, threshold: "1" }).success).toBe(
    false,
  );
});

it("never meets an alert with no figure yet", () => {
  expect(meets(waiting({ threshold: null }), "999999")).toBe(false);
});
