import {
  INSTRUMENT_SYMBOL_PATTERN,
  LOCAL_SYMBOL_PATTERN,
  usListingSymbol,
  usTicker,
  shownTicker,
} from "./symbol";

it.each(["VOO.US", "BRK-B.US", "AAPL", "ABCDEFGHIJKLMNO", "GD30D"])(
  "takes %s as a catalog symbol",
  (symbol) => {
    expect(INSTRUMENT_SYMBOL_PATTERN.test(symbol)).toBe(true);
  },
);

it.each([
  "VOO.us",
  "VOO.BA",
  ".US",
  "BRK-BBB.US",
  "ABCDEFGHIJK.US",
  "ABCDEFGHIJKLMNOP",
  "aapl",
])("refuses %s as a catalog symbol", (symbol) => {
  expect(INSTRUMENT_SYMBOL_PATTERN.test(symbol)).toBe(false);
});

it("keeps the US form out of the local pattern", () => {
  expect(LOCAL_SYMBOL_PATTERN.test("VOO.US")).toBe(false);
  expect(LOCAL_SYMBOL_PATTERN.test("VOO")).toBe(true);
});

it.each([
  ["VOO", "VOO.US"],
  ["voo", "VOO.US"],
  ["BRK B", "BRK-B.US"],
  ["BRK.B", "BRK-B.US"],
  ["BRK/B", "BRK-B.US"],
  ["ABCDEFGHIJK", null],
  ["", null],
])("names the US listing of %j %j", (ticker, symbol) => {
  expect(usListingSymbol(ticker)).toBe(symbol);
});

it.each([
  ["VOO.US", "VOO"],
  ["voo.us", "VOO"],
  ["BRK-B.US", "BRK-B"],
  ["VOO", null],
  ["VOO.BA", null],
  [".US", null],
])("reads the ticker of %j as %j", (symbol, ticker) => {
  expect(usTicker(symbol)).toBe(ticker);
});

it("shows a US listing by its bare ticker and any other symbol as it is", () => {
  expect(shownTicker("MELI.US")).toBe("MELI");
  expect(shownTicker("BRK-B.US")).toBe("BRK-B");
  expect(shownTicker("MELI")).toBe("MELI");
  expect(shownTicker("GD30D")).toBe("GD30D");
});
