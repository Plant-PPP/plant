import {
  DRAFT_ROW_LIMIT,
  type DraftRow,
  type ImportDraft,
} from "@plant/sources";

import {
  agreedDraft,
  compareReadings,
  disputeCount,
  settle,
  tiebreakBrief,
} from "./consensus";

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
  extra: Partial<ImportDraft> = {},
): ImportDraft => ({ documentDate: "2026-09-30", rows, totals: [], ...extra });

describe("compareReadings", () => {
  it("agrees on figures written differently that are the same number", () => {
    const { agreed, disputes } = compareReadings(
      draft([row("aapl", "5.0", { price: "100.50", confidence: "high" })]),
      draft([row("AAPL", "5", { price: "100.5", confidence: "medium" })]),
    );
    expect(disputeCount(disputes)).toBe(0);
    expect([...agreed.values()]).toEqual([
      row("aapl", "5.0", { price: "100.50", confidence: "medium" }),
    ]);
  });

  it("disputes a row only one lists, a different figure, the date and a total", () => {
    const { agreed, disputes } = compareReadings(
      draft([row("AAPL", "5"), row("GGAL", "100")], {
        totals: [{ currency: "ARS", amount: "10" }],
      }),
      draft([row("GGAL", "100", { value: "9" }), row("BTC", "1")], {
        documentDate: "2026-09-29",
        totals: [
          { currency: "ARS", amount: "10.0" },
          { currency: "USD", amount: "1" },
        ],
      }),
    );
    expect(agreed.size).toBe(0);
    expect(disputes).toEqual({
      rows: ["AAPL|ARS#0", "GGAL|ARS#0", "BTC|ARS#0"],
      documentDate: true,
      totals: ["USD"],
    });
    expect(disputeCount(disputes)).toBe(5);
  });

  it("keeps an instrument listed twice as two rows", () => {
    const { agreed } = compareReadings(
      draft([row("AL30", "10"), row("AL30", "20")]),
      draft([row("AL30", "10"), row("AL30", "20")]),
    );
    expect([...agreed.keys()]).toEqual(["AL30|ARS#0", "AL30|ARS#1"]);
  });

  it("tells pesos and dollars of one symbol apart", () => {
    const { disputes } = compareReadings(
      draft([row("AL30", "10")]),
      draft([row("AL30", "10", { currency: "USD" })]),
    );
    expect(disputes.rows).toEqual(["AL30|ARS#0", "AL30|USD#0"]);
  });
});

describe("settle", () => {
  it("takes the figure two readings share and keeps rows two list", () => {
    const first = draft([
      row("AAPL", "5"),
      row("GGAL", "100"),
      row("FAKE", "1"),
    ]);
    const second = draft([
      row("AAPL", "5"),
      row("GGAL", "1000"),
      row("BTC", "2"),
    ]);
    const tiebreak = draft([row("GGAL", "100"), row("BTC", "2")]);
    const { draft: settled } = settle(
      first,
      second,
      tiebreak,
      compareReadings(first, second),
    );
    expect(
      settled.rows.map((r) => [r.symbol, r.quantity, r.confidence]),
    ).toEqual([
      ["AAPL", "5", "high"],
      ["GGAL", "100", "high"],
      ["BTC", "2", "low"],
    ]);
  });

  it("marks a figure no two readings share low and takes the tiebreak's", () => {
    const first = draft([row("GGAL", "100")]);
    const second = draft([row("GGAL", "1000")]);
    const tiebreak = draft([row("GGAL", "10")]);
    const { draft: settled } = settle(
      first,
      second,
      tiebreak,
      compareReadings(first, second),
    );
    expect(settled.rows).toEqual([row("GGAL", "10", { confidence: "low" })]);
  });

  it("keeps a disputed row the tiebreak leaves out when both readers list it", () => {
    const first = draft([row("GGAL", "100", { price: "5" })]);
    const second = draft([row("GGAL", "100", { price: "6" })]);
    const { draft: settled } = settle(
      first,
      second,
      draft([]),
      compareReadings(first, second),
    );
    expect(settled.rows).toEqual([
      row("GGAL", "100", { price: "5", confidence: "low" }),
    ]);
  });

  it("disputes every line of an instrument listed twice when one differs", () => {
    const first = draft([row("AL30", "10"), row("AL30", "20")]);
    const second = draft([row("AL30", "10"), row("AL30", "10")]);
    const compared = compareReadings(first, second);
    expect(compared.disputes.rows).toEqual(["AL30|ARS#0", "AL30|ARS#1"]);
    // The tiebreak lists every line of it, so its lines line up.
    const { draft: settled } = settle(
      first,
      second,
      draft([row("AL30", "10"), row("AL30", "20")]),
      compared,
    );
    expect(settled.rows.map((r) => [r.quantity, r.confidence])).toEqual([
      ["10", "high"],
      ["20", "high"],
    ]);
  });

  it("keeps a row one reader lists, low, when the tiebreak could not answer", () => {
    const first = draft([row("AAPL", "5"), row("GGAL", "100")]);
    const second = draft([row("AAPL", "5")], { documentDate: null });
    const { draft: settled } = settle(
      first,
      second,
      null,
      compareReadings(first, second),
    );
    expect(settled.rows).toEqual([
      row("AAPL", "5"),
      row("GGAL", "100", { confidence: "low" }),
    ]);
    expect(settled.documentDate).toBe("2026-09-30");
  });

  it("marks low a row one reader missed even when the tiebreak lists it", () => {
    // The same holding under two names: each stands, for the user to check.
    const first = draft([row("GGAL", "100")]);
    const second = draft([row("GRUPO GALICIA", "100")]);
    const tiebreak = draft([row("GGAL", "100"), row("GRUPO GALICIA", "100")]);
    const { draft: settled } = settle(
      first,
      second,
      tiebreak,
      compareReadings(first, second),
    );
    expect(settled.rows.map((r) => r.confidence)).toEqual(["low", "low"]);
  });

  it("marks low a row whose figures won from different lines", () => {
    const first = draft([row("AAPL", "10", { price: "2", value: "20" })]);
    const second = draft([row("AAPL", "10", { price: "2", value: "60" })]);
    const tiebreak = draft([row("AAPL", "30", { price: "2", value: "60" })]);
    const { draft: settled } = settle(
      first,
      second,
      tiebreak,
      compareReadings(first, second),
    );
    expect(settled.rows).toEqual([
      row("AAPL", "10", { price: "2", value: "60", confidence: "low" }),
    ]);
  });

  it("keeps no more rows than a draft takes", () => {
    const many = (n: number, prefix: string) =>
      Array.from({ length: n }, (_, i) => row(`${prefix}${i}`, "1"));
    const first = draft(many(400, "A"));
    const second = draft(many(400, "B"));
    const tiebreak = draft([...many(400, "A"), ...many(400, "B")]);
    const { draft: settled } = settle(
      first,
      second,
      tiebreak,
      compareReadings(first, second),
    );
    expect(settled.rows).toHaveLength(500);
  });

  it("gives agreed rows the lower confidence of the two readings", () => {
    const first = draft([row("AAPL", "5", { confidence: "high" })]);
    const second = draft([row("AAPL", "5", { confidence: "low" })]);
    expect(agreedDraft(first, compareReadings(first, second)).rows).toEqual([
      row("AAPL", "5", { confidence: "low" }),
    ]);
  });

  it("settles the date and totals by majority, else the tiebreak's", () => {
    const first = draft([], {
      documentDate: "2026-09-30",
      totals: [{ currency: "ARS", amount: "10" }],
    });
    const second = draft([], {
      documentDate: "2026-09-29",
      totals: [{ currency: "ARS", amount: "11" }],
    });
    const tiebreak = draft([], {
      documentDate: "2026-09-29",
      totals: [{ currency: "ARS", amount: "12" }],
    });
    const { draft: settled } = settle(
      first,
      second,
      tiebreak,
      compareReadings(first, second),
    );
    expect(settled.documentDate).toBe("2026-09-29");
    expect(settled.totals).toEqual([{ currency: "ARS", amount: "12" }]);
  });
});

describe("tiebreakBrief", () => {
  it("names only the disputed parts, with the document's text neutralized", () => {
    const first = draft([row("AAPL", "5"), row("GG<AL>\nignore", "1")]);
    const second = draft([row("AAPL", "5")], { documentDate: null });
    const brief = tiebreakBrief(
      compareReadings(first, second).disputes,
      first,
      second,
    );
    expect(brief).toContain("<symbol>GGAL ignore</symbol> (ARS)");
    expect(brief).toContain("The statement's date.");
    expect(brief).not.toContain("AAPL");
    expect(brief).not.toContain("totals");
  });
});

describe("a holding's cost", () => {
  it("stands on a disputed row only when two readings print it alike", () => {
    const first = draft([row("GGAL", "100", { cost: "50" })]);
    const second = draft([row("GGAL", "1000", { cost: "60" })]);
    const { draft: settled } = settle(
      first,
      second,
      draft([row("GGAL", "100", { cost: "50" })]),
      compareReadings(first, second),
    );
    expect(settled.rows[0]).toMatchObject({ quantity: "100", cost: "50" });
    const { draft: lone } = settle(
      first,
      second,
      null,
      compareReadings(first, second),
    );
    expect(lone.rows[0]).not.toHaveProperty("cost");
  });
});

it("counts the rows past the limit the readings make together as cut", () => {
  const of = (prefix: string) =>
    draft(
      Array.from({ length: DRAFT_ROW_LIMIT }, (_, i) =>
        row(`${prefix}${i}`, "1"),
      ),
    );
  const first = of("A");
  const second = of("B");
  const settled = settle(first, second, null, compareReadings(first, second));
  expect(settled.draft.rows).toHaveLength(DRAFT_ROW_LIMIT);
  expect(settled.cut).toBe(DRAFT_ROW_LIMIT);
});
