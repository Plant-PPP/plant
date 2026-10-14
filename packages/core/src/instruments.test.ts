import {
  type CatalogInstrument,
  exactUnitPrice,
  instrumentIndex,
  normalizeSymbol,
  quotedPrice,
  resolveSymbol,
  unitPrice,
} from "./instruments";

it("prices a bond per 100 nominal and anything else per unit", () => {
  expect(unitPrice("bond", "85")).toBe("0.85");
  expect(quotedPrice("bond", "0.85")).toBe("85");
  expect(unitPrice("cedear", "18650")).toBe("18650");
  expect(quotedPrice("crypto", "65123.45")).toBe("65123.45");
});

it("rounds a unit price to 8 decimals", () => {
  expect(unitPrice("bond", "0.00000123")).toBe("0.00000001");
});

it("refuses a typed quote whose unit price 8 decimals cannot hold", () => {
  expect(exactUnitPrice("bond", "98.12345678")).toBeNull();
  expect(exactUnitPrice("bond", "98.123456")).toBe("0.98123456");
  expect(exactUnitPrice("cedear", "18650.5")).toBe("18650.5");
});

it("refuses a typed quote with more digits than a decimal string holds", () => {
  expect(exactUnitPrice("cedear", "1.123456789")).toBeNull();
  expect(exactUnitPrice("cedear", "1234567890123")).toBeNull();
});

it("normalizes a symbol to upper-case letters and digits", () => {
  expect(normalizeSymbol("  Coca-Cola ")).toBe("COCACOLA");
  expect(normalizeSymbol("Ñandú S.A.")).toBe("NANDUSA");
  expect(normalizeSymbol("al30")).toBe("AL30");
});

describe("resolveSymbol", () => {
  const catalog: CatalogInstrument[] = [
    { symbol: "ZBTC", type: "crypto", currency: "USD", aliases: ["Zbitcoin"] },
    { symbol: "ZB30", type: "bond", currency: "ARS", aliases: ["Bono Z 2030"] },
    { symbol: "ZKO", type: "cedear", currency: "ARS", aliases: ["COCA COLA"] },
    { symbol: "ZXY", type: "cedear", currency: "ARS", aliases: [] },
    { symbol: "ZXYD", type: "cedear", currency: "ARS", aliases: [] },
  ];
  const index = instrumentIndex(catalog);
  const resolve = (text: string) => resolveSymbol(text, index);

  it("finds an exact symbol of each class, whatever its case", () => {
    expect(resolve("zbtc")).toEqual({
      symbol: "ZBTC",
      type: "crypto",
      instrumentCurrency: "USD",
      currency: "USD",
      dollarLine: false,
    });
    expect(resolve(" ZB30 ")?.symbol).toBe("ZB30");
    expect(resolve("ZKO")?.currency).toBe("ARS");
  });

  it("drops a trailing .BA", () => {
    expect(resolve("ZKO.BA")?.symbol).toBe("ZKO");
    expect(resolve("zb30.ba")?.symbol).toBe("ZB30");
  });

  it("reads a D or C bond or CEDEAR line as its base in dollars", () => {
    expect(resolve("ZB30D")).toEqual({
      symbol: "ZB30",
      type: "bond",
      instrumentCurrency: "ARS",
      currency: "USD",
      dollarLine: true,
    });
    expect(resolve("ZKOC")).toMatchObject({ symbol: "ZKO", currency: "USD" });
    expect(resolve("ZB30D.BA")).toMatchObject({
      symbol: "ZB30",
      currency: "USD",
    });
  });

  it("keeps a catalog symbol that ends in D", () => {
    expect(resolve("ZXYD")).toMatchObject({
      symbol: "ZXYD",
      currency: "ARS",
      dollarLine: false,
    });
    expect(resolve("ZXYC")).toMatchObject({
      symbol: "ZXY",
      currency: "USD",
      dollarLine: true,
    });
  });

  it("never reads a crypto with a D or C suffix as a dollar line", () => {
    expect(resolve("ZBTCD")).toBeNull();
  });

  it("matches an alias whatever its punctuation and accents", () => {
    expect(resolve("Coca-Cola")?.symbol).toBe("ZKO");
    expect(resolve("bono z 2030")?.symbol).toBe("ZB30");
    expect(resolve("ZBITCÓIN")?.symbol).toBe("ZBTC");
  });

  it("finds nothing for an unknown or empty name", () => {
    expect(resolve("ZZZ")).toBeNull();
    expect(resolve(".BA")).toBeNull();
    expect(resolve("D")).toBeNull();
  });
});
