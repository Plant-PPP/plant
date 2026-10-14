import type { DraftOperation } from "@plant/sources";

import { mergeOperations } from "./operation-consensus";

const operation = (extra: Partial<DraftOperation> = {}): DraftOperation => ({
  date: "2026-09-01",
  kind: "purchase",
  symbol: "GGAL",
  quantity: "100",
  price: "5000",
  amount: null,
  charges: "25.5",
  reference: "123",
  currency: "ARS",
  confidence: "high",
  page: 1,
  ...extra,
});

it("keeps what two readings agree on, however written, at the lower confidence", () => {
  expect(
    mergeOperations(
      [operation({ quantity: "100.0" })],
      [operation({ charges: "25.50", confidence: "medium" })],
    ),
  ).toEqual([operation({ quantity: "100.0", confidence: "medium" })]);
});

it("leaves each field the readings disagree on for the review", () => {
  expect(
    mergeOperations(
      [operation()],
      [operation({ date: "2026-09-02", kind: "sale", price: "5100" })],
    ),
  ).toEqual([
    operation({ date: null, kind: null, price: null, confidence: "low" }),
  ]);
});

it("keeps an operation only one reading lists, for the user to check", () => {
  expect(
    mergeOperations(
      [operation(), operation({ symbol: "YPFD" })],
      [operation()],
    ),
  ).toEqual([operation(), operation({ symbol: "YPFD", confidence: "low" })]);
});

it("matches an instrument's operations by occurrence, a missing name too", () => {
  const merged = mergeOperations(
    [
      operation({ symbol: null, quantity: "1" }),
      operation({ symbol: null, quantity: "2" }),
    ],
    [
      operation({ symbol: null, quantity: "1" }),
      operation({ symbol: null, quantity: "2" }),
    ],
  );
  expect(merged.map((each) => [each.quantity, each.confidence])).toEqual([
    ["1", "high"],
    ["2", "high"],
  ]);
});
