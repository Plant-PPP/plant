import { importDraftSchema, SourceError } from "./draft";

const row = {
  symbol: "AAPL",
  quantity: "5",
  price: "18000.5",
  currency: "ARS",
  confidence: "high",
  page: 1,
};

describe("importDraftSchema", () => {
  it("takes a document's date and its rows", () => {
    expect(
      importDraftSchema.parse({
        documentDate: "2026-09-30",
        rows: [row, { ...row, symbol: " GD30 ", price: null, page: null }],
      }).rows[1],
    ).toMatchObject({ symbol: "GD30", price: null, page: null });
  });

  it.each([
    ["no units", { quantity: "0" }],
    ["a float", { quantity: 5 }],
    ["a currency it does not know", { currency: "EUR" }],
    ["a page 0", { page: 0 }],
    ["an extra field", { cuit: "20-12345678-9" }],
  ])("refuses a row with %s", (_, patch) => {
    expect(
      importDraftSchema.safeParse({
        documentDate: null,
        rows: [{ ...row, ...patch }],
      }).success,
    ).toBe(false);
  });
});

describe("SourceError", () => {
  it("carries its code and whether a retry may pass", () => {
    const error = new SourceError("extraction_failed", true);
    expect(error).toMatchObject({
      code: "extraction_failed",
      retryable: true,
      message: "source failed: extraction_failed",
    });
  });
});
