import type { DraftRow, ImportDraft } from "@plant/sources";

import {
  expectedReadingSchema,
  meetsTheBar,
  type ReadingScore,
  scoreReading,
} from "./score";

const row = (
  symbol: string,
  quantity: string,
  extra: Partial<DraftRow> = {},
): DraftRow => ({
  symbol,
  quantity,
  price: null,
  value: null,
  currency: "ARS",
  confidence: "high",
  page: 1,
  ...extra,
});

const draft = (
  rows: DraftRow[],
  totals: ImportDraft["totals"] = [],
): ImportDraft => ({ documentDate: null, rows, totals });

const expected = expectedReadingSchema.parse({
  rows: [
    { symbol: "AL30", quantity: "1000", currency: "USD" },
    { symbol: "GGAL", quantity: "100", currency: "ARS" },
    { symbol: "AAPL", quantity: "5", currency: "ARS" },
  ],
  totals: [{ currency: "ARS", amount: "1500.25" }],
});

describe("scoreReading", () => {
  it("counts a row right when its units match, however written", () => {
    const score = scoreReading(
      expected,
      draft(
        [
          row("al30", "1000.00", { currency: "USD" }),
          row("GGAL", "100"),
          row("AAPL", "5"),
        ],
        [{ currency: "ARS", amount: "1500.250" }],
      ),
    );
    expect(score).toMatchObject({
      rows: 3,
      right: 3,
      flagged: 0,
      wrong: [],
      extra: [],
      totalsRight: 1,
    });
  });

  it("counts a misread row flagged when marked low, else wrong", () => {
    const score = scoreReading(
      expected,
      draft([
        row("AL30", "100", { currency: "USD", confidence: "low" }),
        row("GGAL", "10"),
      ]),
    );
    expect(score).toMatchObject({
      right: 0,
      flagged: 1,
      wrong: ["GGAL|ARS", "AAPL|ARS"],
      extra: ["GGAL|ARS"],
      wrongTotals: ["ARS"],
    });
  });

  it("tells pesos and dollars of one symbol apart", () => {
    const score = scoreReading(expected, draft([row("AL30", "1000")]));
    expect(score.wrong).toContain("AL30|USD");
    expect(score.extra).toEqual(["AL30|ARS"]);
  });
});

describe("meetsTheBar", () => {
  const score = (over: Partial<ReadingScore>): ReadingScore => ({
    rows: 20,
    right: 20,
    flagged: 0,
    wrong: [],
    extra: [],
    totals: 1,
    totalsRight: 1,
    wrongTotals: [],
    ...over,
  });

  it("passes at 95% of the rows right or flagged with every total right", () => {
    expect(meetsTheBar([score({ right: 18, flagged: 1 })]).passes).toBe(true);
  });

  it("fails under 95% of the rows or with a wrong total", () => {
    expect(meetsTheBar([score({ right: 18 })]).passes).toBe(false);
    expect(meetsTheBar([score({ totalsRight: 0 })]).passes).toBe(false);
  });
});

it("refuses an expected file with a quantity that is not a plain decimal", () => {
  expect(
    expectedReadingSchema.safeParse({
      rows: [{ symbol: "AL30", quantity: "1.000,5", currency: "USD" }],
    }).success,
  ).toBe(false);
});
