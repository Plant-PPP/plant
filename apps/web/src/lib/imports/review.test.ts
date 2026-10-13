import { readTotals, rowChange, totalsMatch } from "./review";

const row = (quantity: string, price: string | null, discarded = false) => ({
  id: quantity,
  symbol: "AAPL",
  quantity,
  price,
  currency: "ARS" as const,
  confidence: "high" as const,
  source: "Página 1",
  discarded,
});

it("says what a row does to the account", () => {
  expect(rowChange(row("5", "1"), undefined)).toEqual({ kind: "new" });
  expect(rowChange(row("5", "1"), "3")).toEqual({ kind: "up", held: "3" });
  expect(rowChange(row("2", "1"), "3")).toEqual({ kind: "down", held: "3" });
  expect(rowChange(row("3", "1"), "3.0")).toEqual({ kind: "same" });
  expect(rowChange(row("3", "1", true), "3")).toEqual({ kind: "discarded" });
});

it("adds up what was read, leaving out discarded and unpriced rows", () => {
  const totals = readTotals([
    row("2", "100.5"),
    row("1", null),
    row("10", "1", true),
  ]);
  expect(totals).toEqual([{ currency: "ARS", amount: "201" }]);
  expect(totalsMatch(totals, [{ currency: "ARS", amount: "201.00" }])).toBe(
    true,
  );
  expect(totalsMatch(totals, [{ currency: "ARS", amount: "200" }])).toBe(false);
  // A currency read that the document prints no total for leaves nothing to
  // compare: one peso total over peso and dollar rows.
  expect(totalsMatch(totals, [{ currency: "USD", amount: "1" }])).toBe("none");
  expect(
    totalsMatch(
      [...totals, { currency: "USD", amount: "5" }],
      [{ currency: "ARS", amount: "201" }],
    ),
  ).toBe("none");
  // Nor does a printed currency nothing was read in.
  expect(
    totalsMatch(totals, [
      { currency: "ARS", amount: "201" },
      { currency: "USD", amount: "5" },
    ]),
  ).toBe("none");
  expect(totalsMatch(totals, [])).toBe("none");
});
