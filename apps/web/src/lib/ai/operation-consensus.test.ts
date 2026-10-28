import { DRAFT_ROW_LIMIT, type DraftOperation } from "@plant/sources";

import { mergeOperations } from "./operation-consensus";

const operation = (extra: Partial<DraftOperation> = {}): DraftOperation => ({
  date: "2026-09-01",
  kind: "purchase",
  direction: null,
  symbol: "GGAL",
  quantity: "100",
  price: "5000",
  amount: null,
  charges: "25.5",
  reference: "123",
  currency: "ARS",
  confidence: "high",
  page: 1,
  debtPayment: false,
  ...extra,
});

it("keeps what two readings agree on, however written, at the lower confidence", () => {
  expect(
    mergeOperations(
      [operation({ quantity: "100.0" })],
      [operation({ charges: "25.50", confidence: "medium" })],
    ).rows,
  ).toEqual([operation({ quantity: "100.0", confidence: "medium" })]);
});

it("leaves each field the readings disagree on for the review", () => {
  expect(
    mergeOperations(
      [operation()],
      [operation({ date: "2026-09-02", kind: "sale", price: "5100" })],
    ).rows,
  ).toEqual([
    operation({ date: null, kind: null, price: null, confidence: "low" }),
  ]);
});

it("keeps an operation only one reading lists, for the user to check", () => {
  expect(
    mergeOperations([operation(), operation({ symbol: "YPFD" })], [operation()])
      .rows,
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
  ).rows;
  expect(merged.map((each) => [each.quantity, each.confidence])).toEqual([
    ["1", "high"],
    ["2", "high"],
  ]);
});

it("pairs operations named differently by their number, else date, kind and units", () => {
  expect(
    mergeOperations(
      [
        operation({ symbol: "GGAL" }),
        operation({ symbol: "YPFD", reference: null, quantity: "7" }),
      ],
      [
        operation({ symbol: "GRUPO GALICIA" }),
        operation({ symbol: "YPF", reference: null, quantity: "7" }),
      ],
    ).rows.map((each) => [each.symbol, each.quantity, each.confidence]),
  ).toEqual([
    [null, "100", "low"],
    [null, "7", "low"],
  ]);
});

it("marks low an operation the readers read in different currencies", () => {
  expect(
    mergeOperations([operation()], [operation({ currency: "USD" })]).rows,
  ).toEqual([operation({ confidence: "low" })]);
});

it("counts the operations past the limit the two readings make together as cut", () => {
  const of = (prefix: string, from: number) =>
    Array.from({ length: DRAFT_ROW_LIMIT }, (_, i) =>
      operation({
        reference: `${prefix}${i}`,
        symbol: `${prefix}${i}`,
        quantity: String(from + i),
      }),
    );
  const merged = mergeOperations(of("A", 1), of("B", 1001));
  expect(merged.rows).toHaveLength(DRAFT_ROW_LIMIT);
  expect(merged.cut).toBe(DRAFT_ROW_LIMIT);
});

it("leaves an adjustment whose direction the readings disagree on for the review", () => {
  const [row] = mergeOperations(
    [operation({ kind: "adjustment", direction: "in" })],
    [operation({ kind: "adjustment", direction: "out" })],
  ).rows;
  expect(row).toMatchObject({ kind: null, direction: null, confidence: "low" });
});

it("keeps an adjustment's direction the readings agree on", () => {
  const [row] = mergeOperations(
    [operation({ kind: "adjustment", direction: "out" })],
    [operation({ kind: "adjustment", direction: "out" })],
  ).rows;
  expect(row).toMatchObject({ kind: "adjustment", direction: "out" });
});

it("keeps a debt payment both readings name, and names none they disagree on", () => {
  const payment = operation({
    kind: null,
    debtPayment: true,
    price: null,
    charges: null,
  });
  expect(mergeOperations([payment], [payment]).rows).toEqual([payment]);
  expect(
    mergeOperations(
      [payment],
      [
        operation({
          kind: "adjustment",
          direction: "out",
          price: null,
          charges: null,
        }),
      ],
    ).rows,
  ).toEqual([
    {
      ...payment,
      debtPayment: false,
      kind: null,
      direction: null,
      confidence: "low",
    },
  ]);
});
