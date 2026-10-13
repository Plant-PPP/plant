import type { QuoteSnapshot } from "./contract/quote";
import {
  admitManualPrice,
  type ManualPrice,
  manualPriceSchema,
  priceSource,
  withManualPrices,
  withManualRates,
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

it("takes a manual price over the feed's of the same day", () => {
  const priced = withManualPrices(SNAPSHOT, [price("BTC", "2026-10-12", "1")]);
  expect(priced.snapshot.prices.BTC).toEqual({
    price: "1",
    currency: "ARS",
    date: "2026-10-12",
  });
  expect(priceSource("BTC", priced)).toBe("manual");
});

it("keeps a feed price newer than the manual one", () => {
  const priced = withManualPrices(SNAPSHOT, [price("BTC", "2026-10-11", "1")]);
  expect(priced.snapshot.prices.BTC?.price).toBe("65000");
  expect(priceSource("BTC", priced)).toBe("feed");
  expect(priced.manual.has("BTC")).toBe(false);
});

it("takes a manual price newer than the feed's, which a feed may carry over a weekend", () => {
  const carried: QuoteSnapshot = {
    ...SNAPSHOT,
    prices: { BTC: { price: "65000", currency: "USD", date: "2026-10-10" } },
  };
  const priced = withManualPrices(carried, [price("BTC", "2026-10-11", "1")]);
  expect(priced.snapshot.prices.BTC?.price).toBe("1");
  expect(priced.manual.get("BTC")).toBe("2026-10-11");
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

it("reads a symbol with no price as missing", () => {
  const priced = withManualPrices(SNAPSHOT, []);
  expect(priceSource("KO", priced)).toBe("missing");
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

describe("withManualRates", () => {
  const rate = (kind: "mep" | "ccl", rate_date: string, sell: string) => ({
    kind,
    rate_date,
    sell,
  });
  const quoted: QuoteSnapshot = {
    ...SNAPSHOT,
    fx: { mep: { sell: "1200", date: "2026-10-12" } },
  };

  it("takes a rate the user states over the feed's of the same day", () => {
    const priced = withManualRates(quoted, [rate("mep", "2026-10-12", "1250")]);
    expect(priced.snapshot.fx.mep).toEqual({
      sell: "1250",
      date: "2026-10-12",
    });
    expect(priced.manual.get("mep")).toBe("2026-10-12");
  });

  it("keeps a newer feed rate, and fills a kind the feeds lack", () => {
    const priced = withManualRates(quoted, [
      rate("mep", "2026-10-09", "1100"),
      rate("ccl", "2026-10-01", "1300"),
    ]);
    expect(priced.snapshot.fx.mep?.sell).toBe("1200");
    expect(priced.manual.has("mep")).toBe(false);
    expect(priced.snapshot.fx.ccl).toEqual({
      sell: "1300",
      date: "2026-10-01",
    });
  });

  it("ignores a rate after the snapshot's date", () => {
    expect(
      withManualRates(quoted, [rate("mep", "2026-10-13", "1")]).snapshot.fx.mep
        ?.sell,
    ).toBe("1200");
  });
});
