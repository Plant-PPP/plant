import { EMPTY_POSITION } from "@plant/core";

import { instrumentSummary } from "./instrument-history";
import type { HoldingRow } from "./read";

const row = { id: "h1" } as HoldingRow;
const position = (quantity: string, cost: string, realized = "0") => ({
  quantity,
  money: { cost, charges: "1", income: "2", realized },
});

it("sums the open holdings' value and cost, and every holding's results", () => {
  const summary = instrumentSummary(
    [
      { row, closed: false, position: position("2", "100"), value: "130" },
      { row, closed: true, position: position("0", "0", "15"), value: null },
    ],
    [
      { date: "2025-01-01", amount: "-100", kind: "buy", charges: "0" },
      { date: "2025-06-01", amount: "40", kind: "sell", charges: "0" },
    ],
    "2025-12-01",
    "130",
  );
  expect(summary).toMatchObject({
    quantity: "2",
    value: "130",
    cost: "100",
    unrealized: { amount: "30", percent: "30" },
    realized: "15",
    income: "4",
    charges: "2",
  });
  expect(summary.returns).toMatchObject({ result: "70", annual: null });
});

it("has no result while a held unit has no value", () => {
  const summary = instrumentSummary(
    [{ row, closed: false, position: EMPTY_POSITION, value: null }],
    [],
    "2025-12-01",
    null,
  );
  expect(summary.value).toBeNull();
  expect(summary.returns).toBeNull();
});

it("takes its value and gain over the exact sum it is given", () => {
  const summary = instrumentSummary(
    [
      { row, closed: false, position: position("0.5", "500"), value: "500.01" },
      { row, closed: false, position: position("0.5", "500"), value: "500.01" },
    ],
    [],
    "2025-12-01",
    // 1000.01 split in two halves of 500.005, each rounded up alone.
    "1000.01",
  );
  expect(summary).toMatchObject({
    value: "1000.01",
    unrealized: { amount: "0.01" },
  });
});
