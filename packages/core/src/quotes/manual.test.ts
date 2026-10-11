import type { QuoteSnapshot } from "./contract/quote";
import {
  acceptsManualPrice,
  admitManualPrice,
  type ManualPrice,
  manualPriceSchema,
  priceSource,
  withManualPrices,
} from "./manual";

const SNAPSHOT: QuoteSnapshot = {
  date: "2026-10-12",
  fx: {},
  prices: { BTC: { price: "65000", currency: "USD", date: "2026-10-12" } },
};

const price = (
  symbol: string,
  price_date: string,
  value: string,
): ManualPrice => ({ symbol, price_date, price: value, currency: "ARS" });

it("keeps a feed price over a manual one", () => {
  const priced = withManualPrices(SNAPSHOT, [price("BTC", "2026-10-12", "1")]);
  expect(priced.snapshot.prices.BTC?.price).toBe("65000");
  expect(priceSource("BTC", priced)).toBe("feed");
  expect(acceptsManualPrice("BTC", priced)).toBe(false);
});

it("takes the latest manual price on or before the date, at any age", () => {
  const priced = withManualPrices(SNAPSHOT, [
    price("KO", "2025-01-02", "8000"),
    price("KO", "2025-06-30", "9100"),
    price("KO", "2026-10-13", "9999"),
  ]);
  expect(priced.snapshot.prices.KO).toEqual({
    price: "9100",
    currency: "ARS",
    date: "2025-06-30",
  });
  expect(priced.manual.get("KO")).toBe("2025-06-30");
  expect(priceSource("KO", priced)).toBe("manual");
});

it("reads a symbol with no price as missing, open to a manual one", () => {
  const priced = withManualPrices(SNAPSHOT, []);
  expect(priceSource("KO", priced)).toBe("missing");
  expect(acceptsManualPrice("KO", priced)).toBe(true);
});

it("refuses a future date", () => {
  expect(
    admitManualPrice(price("KO", "2026-10-13", "1"), "2026-10-12"),
  ).toEqual({ ok: false, code: "future_date" });
  expect(
    admitManualPrice(price("KO", "2026-10-12", "1"), "2026-10-12"),
  ).toEqual({ ok: true });
});

it("refuses a price that is not positive or an unknown key", () => {
  expect(
    manualPriceSchema.safeParse(price("KO", "2026-10-12", "0")).success,
  ).toBe(false);
  expect(
    manualPriceSchema.safeParse({ ...price("KO", "2026-10-12", "1"), x: 1 })
      .success,
  ).toBe(false);
});
