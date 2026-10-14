import { draftAssetClassSchema, importDraftSchema, SourceError } from "./draft";

const row = {
  symbol: "AAPL",
  quantity: "5",
  price: "18000.5",
  value: "90002.5",
  currency: "ARS",
  confidence: "high",
  page: 1,
};

describe("importDraftSchema", () => {
  it("takes a document's date and its rows", () => {
    expect(
      importDraftSchema.parse({
        documentDate: "2026-09-30",
        rows: [
          row,
          { ...row, symbol: " GD30 ", price: null, value: null, page: null },
        ],
        totals: [],
      }).rows[1],
    ).toMatchObject({ symbol: "GD30", price: null, value: null, page: null });
  });

  it("takes the totals the document prints, one per currency", () => {
    const totals = [
      { currency: "ARS", amount: "1500000.25" },
      { currency: "USD", amount: "0" },
    ];
    expect(
      importDraftSchema.parse({ documentDate: null, rows: [row], totals })
        .totals,
    ).toEqual(totals);
  });

  it.each([
    [
      "two of one currency",
      [
        { currency: "USD", amount: "10" },
        { currency: "USD", amount: "20" },
      ],
    ],
    ["a negative amount", [{ currency: "ARS", amount: "-1" }]],
    ["a float amount", [{ currency: "ARS", amount: 1 }]],
  ])("refuses totals with %s", (_, totals) => {
    expect(
      importDraftSchema.safeParse({ documentDate: null, rows: [], totals })
        .success,
    ).toBe(false);
  });

  it("takes cash at zero, a balance the account no longer holds", () => {
    const cash = {
      ...row,
      symbol: "ARS",
      quantity: "0",
      price: null,
      value: null,
      assetClass: "cash",
    };
    expect(
      importDraftSchema.parse({ documentDate: null, rows: [cash], totals: [] })
        .rows[0],
    ).toMatchObject({ assetClass: "cash", quantity: "0" });
    expect(
      importDraftSchema.safeParse({
        documentDate: null,
        rows: [{ ...cash, quantity: "-1" }],
        totals: [],
      }).success,
    ).toBe(false);
  });

  it.each([
    ["no units", { quantity: "0" }],
    ["a float", { quantity: 5 }],
    ["a currency it does not know", { currency: "GBP" }],
    ["a page 0", { page: 0 }],
    ["a value of 0", { value: "0" }],
    ["an extra field", { cuit: "20-12345678-9" }],
  ])("refuses a row with %s", (_, patch) => {
    expect(
      importDraftSchema.safeParse({
        documentDate: null,
        rows: [{ ...row, ...patch }],
        totals: [],
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

it("takes a draft row as an instrument or as cash, as the database names them", () => {
  expect(draftAssetClassSchema.options).toEqual(["instrument", "cash"]);
});
