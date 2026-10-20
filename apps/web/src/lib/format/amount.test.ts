import {
  amountInput,
  currencySymbol,
  formatAmount,
  formatPrice,
  formatQuantity,
  formatShare,
  parseAmountInput,
  percentInput,
  percentToFraction,
  typedAmount,
} from "./amount";
import { formatDate } from "./date";

describe("formatAmount", () => {
  it.each([
    ["1234567.89", "ars", "$ 1.234.567,89"],
    ["12345.67", "usd_mep", "US$ 12.345,67"],
    ["12345.67", "USD", "US$ 12.345,67"],
    ["1234567.89", "ARS", "$ 1.234.567,89"],
    ["1234.56", "EUR", "€ 1.234,56"],
    ["-1234.56", "EUR", "-€ 1.234,56"],
    ["1234.56", "eur", "€ 1.234,56"],
    ["0.5", "btc", "0,50000000 BTC"],
    ["39000000", "ars", "$ 39.000.000,00"],
    ["999999999999.99", "ars", "$ 999.999.999.999,99"],
    ["1234567890123456.5", "ars", "$ 1.234.567.890.123.456,50"],
    ["-1234.5", "ars", "-$ 1.234,50"],
    ["0", "usd_ccl", "US$ 0,00"],
    ["999", "ars", "$ 999,00"],
    ["1000", "ars", "$ 1.000,00"],
  ] as const)("formats %s in %s as %s", (decimal, unit, text) => {
    expect(formatAmount(decimal, unit)).toBe(text);
  });

  it.each([
    ["0.005", "$ 0,01"],
    ["-0.005", "-$ 0,01"],
    ["0.00499999", "$ 0,00"],
    ["1.995", "$ 2,00"],
  ])("rounds %s half away from zero to %s", (decimal, text) => {
    expect(formatAmount(decimal, "ars")).toBe(text);
  });
});

describe("formatPrice", () => {
  it.each([
    ["0.0004", "usd_mep", "US$ 0,0004"],
    ["0.5", "ars", "$ 0,50"],
    ["0.00083333", "usd_mep", "US$ 0,00083333"],
    ["1", "ars", "$ 1,00"],
    ["64150", "usd_mep", "US$ 64.150,00"],
    ["1", "btc", "1,00000000 BTC"],
    ["0.00000001", "btc", "0,00000001 BTC"],
    ["0", "ars", "$ 0,00"],
  ] as const)("writes %s in %s as %s", (price, unit, text) => {
    expect(formatPrice(price, unit)).toBe(text);
  });
});

describe("formatShare", () => {
  it.each([
    ["100", "100,0 %"],
    ["0", "0,0 %"],
    ["12.25", "12,3 %"],
    ["28.6", "28,6 %"],
  ])("writes %s as %s", (share, text) => {
    expect(formatShare(share)).toBe(text);
  });
});

describe("formatQuantity", () => {
  it.each([
    ["0.5", "0,5"],
    ["1234", "1.234"],
    ["0.12345678", "0,12345678"],
    ["2.50000000", "2,5"],
  ])("formats %s as %s", (decimal, text) => {
    expect(formatQuantity(decimal)).toBe(text);
  });
});

describe("parseAmountInput", () => {
  it.each([
    ["1.234.567,89", "1234567.89"],
    ["1234567,89", "1234567.89"],
    ["1234567.89", "1234567.89"],
    ["1.234,5", "1234.5"],
    ["1.234.567", "1234567"],
    ["0.5", "0.5"],
    ["0,5", "0.5"],
    [" 12 ", "12"],
    ["0.500", "0.500"],
    ["12.5", "12.5"],
  ])("reads %j as %s", (text, decimal) => {
    expect(parseAmountInput(text)).toBe(decimal);
  });

  it.each([
    "1.234",
    "12.500",
    "",
    "abc",
    "1,2,3",
    "1.23.4,5",
    "-5",
    "1e5",
    "12,",
    "1.2345678901",
  ])("refuses %j", (text) => {
    expect(parseAmountInput(text)).toBeNull();
  });

  it("round-trips a formatted amount", () => {
    expect(parseAmountInput(formatAmount("1234567.89", "ars").slice(2))).toBe(
      "1234567.89",
    );
  });
});

describe("percents", () => {
  it.each([
    ["0.35", "35"],
    ["0.355", "35,5"],
    ["10", "1000"],
    ["0", "0"],
  ])("starts a field with %s as %s", (fraction, text) => {
    expect(percentInput(fraction)).toBe(text);
    expect(percentToFraction(text)).toBe(fraction);
  });

  it.each([
    ["35", "0.35"],
    ["35,5", "0.355"],
    ["35,5%", "0.355"],
    ["35% ", "0.35"],
    ["0", "0"],
    ["1000", "10"],
  ])("reads %j as %s", (text, fraction) => {
    expect(percentToFraction(text)).toBe(fraction);
  });

  it("refuses garbage", () => {
    expect(percentToFraction("treinta")).toBeNull();
  });

  it("refuses a percent the stored fraction cannot hold exactly", () => {
    expect(percentToFraction("35,123456")).toBe("0.35123456");
    expect(percentToFraction("35,1234567")).toBeNull();
  });
});

describe("formatDate", () => {
  it("writes a date day first", () => {
    expect(formatDate("2026-10-09")).toBe("09/10/2026");
  });
});

describe("amountInput", () => {
  it.each([
    ["1234.5", "1234,5"],
    ["1500.00000000", "1500"],
    ["0.12345678", "0,12345678"],
  ])("writes %s as %s, which reads back the same", (decimal, text) => {
    expect(amountInput(decimal)).toBe(text);
    expect(parseAmountInput(text)).toBe(decimal.replace(/\.?0+$/, ""));
  });
});

it("writes a currency's symbol as its amounts start", () => {
  expect(currencySymbol("ARS")).toBe("$");
  expect(currencySymbol("USD")).toBe("US$");
  expect(currencySymbol("EUR")).toBe("€");
});

describe("typedAmount", () => {
  it.each([
    ["30117,=....2ninini", "30117,2"],
    ["1.234.567,89", "1.234.567,89"],
    ["12.5", "12.5"],
    ["US$ 1.000", "1.000"],
    [",5", "5"],
    ["1,2,3", "1,23"],
    ["1,2.3", "1,23"],
    ["-5", "5"],
  ])("keeps %j as %j", (text, kept) => {
    expect(typedAmount(text)).toBe(kept);
  });
});
