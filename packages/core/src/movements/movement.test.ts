import { adjustment, income, ratesOf, trade } from "./fixtures.test-support";
import {
  isIncome,
  movementSchema,
  startsHolding,
  takesMovements,
  takesUnits,
} from "./movement";

const purchase = {
  id: "m1",
  holding_id: "h1",
  operation_id: "o1",
  entry_order: 1,
  kind: "purchase",
  date: "2026-03-02",
  currency: "USD",
  quantity: "10",
  price: "150.5",
  rates: ratesOf("2026-03-02"),
};

describe("movementSchema", () => {
  it("reads a purchase, with no charges, reference or note by default", () => {
    expect(movementSchema.parse(purchase)).toMatchObject({
      charges: [],
      reference: null,
      note: null,
    });
  });

  it("keeps each charge as the broker lists it", () => {
    const charges = [
      { kind: "commission", label: null, amount: "10" },
      { kind: "vat", label: null, amount: "2.1" },
      { kind: "other", label: "Custodia", amount: "1" },
    ];
    expect(movementSchema.parse({ ...purchase, charges }).charges).toEqual(
      charges,
    );
  });

  it("trims the reference and note", () => {
    expect(
      movementSchema.parse({ ...purchase, reference: " 123-A ", note: " x " }),
    ).toMatchObject({ reference: "123-A", note: "x" });
  });

  it.each([
    [
      "a negative charge",
      {
        ...purchase,
        charges: [{ kind: "commission", label: null, amount: "-1" }],
      },
    ],
    [
      "another charge without a name",
      { ...purchase, charges: [{ kind: "other", label: null, amount: "1" }] },
    ],
    ["an empty reference", { ...purchase, reference: "  " }],
    ["an adjustment without direction", { ...purchase, kind: "adjustment" }],
    [
      "a sale without quantity",
      { ...purchase, kind: "sale", quantity: undefined },
    ],
    [
      "a dividend with a quantity",
      { ...purchase, kind: "dividend", amount: "5" },
    ],
    ["a zero quantity", { ...purchase, quantity: "0" }],
    ["a negative entry order", { ...purchase, entry_order: -1 }],
    ["a fractional entry order", { ...purchase, entry_order: 1.5 }],
    ["no entry order", { ...purchase, entry_order: undefined }],
    ["a null entry order", { ...purchase, entry_order: null }],
    ["an entry order as text", { ...purchase, entry_order: "1" }],
    [
      "a rate kind no unit uses",
      {
        ...purchase,
        rates: {
          ...ratesOf("2026-03-02"),
          uva: { sell: "1", date: "2026-03-02" },
        },
      },
    ],
    [
      "a missing rate kind",
      { ...purchase, rates: { mep: { sell: "1200", date: "2026-03-02" } } },
    ],
    ["an unknown key", { ...purchase, broker: "x" }],
  ])("refuses %s", (_, movement) => {
    expect(movementSchema.safeParse(movement).success).toBe(false);
  });

  it("reads an entry order of 0", () => {
    expect(
      movementSchema.parse({ ...purchase, entry_order: 0 }).entry_order,
    ).toBe(0);
  });

  it("reads a dividend as an amount", () => {
    const { id, holding_id, operation_id, entry_order, date, currency, rates } =
      purchase;
    const dividend = {
      id,
      holding_id,
      operation_id,
      entry_order,
      date,
      currency,
      rates,
      amount: "12",
    };
    expect(
      movementSchema.parse({ ...dividend, kind: "dividend" }),
    ).toMatchObject({ kind: "dividend", amount: "12" });
  });
});

it("takes movements on instrument holdings only", () => {
  expect(takesMovements({ asset_class: "instrument" })).toBe(true);
  expect(takesMovements({ asset_class: "cash" })).toBe(false);
});

it("counts dividends and coupons as income", () => {
  expect(isIncome("dividend")).toBe(true);
  expect(isIncome("coupon")).toBe(true);
  expect(isIncome("sale")).toBe(false);
});

it("starts a holding only with units coming in", () => {
  expect(
    startsHolding(trade("purchase", "1", "1", { date: "2025-01-01" })),
  ).toBe(true);
  expect(startsHolding(adjustment("in", "1", { date: "2025-01-01" }))).toBe(
    true,
  );
  expect(startsHolding(trade("sale", "1", "1", { date: "2025-01-01" }))).toBe(
    false,
  );
  expect(startsHolding(income("dividend", "1", { date: "2025-01-01" }))).toBe(
    false,
  );
});

describe("a transfer", () => {
  const leg = {
    id: "t1",
    holding_id: "h1",
    operation_id: "op",
    entry_order: 1,
    kind: "transfer",
    date: "2026-03-02",
    currency: "USD",
    quantity: "5",
    rates: ratesOf("2026-03-02"),
  };

  it("reads both sides, carrying the cost unless one is set", () => {
    expect(movementSchema.parse({ ...leg, direction: "out" })).toMatchObject({
      price: null,
      charges: [],
    });
    expect(
      movementSchema.parse({ ...leg, direction: "in", price: "400" }),
    ).toMatchObject({ price: "400" });
  });

  it("reads a fee on the side units leave", () => {
    const charges = [{ kind: "commission", label: null, amount: "3" }];
    expect(
      movementSchema.parse({ ...leg, direction: "out", charges }),
    ).toMatchObject({ charges });
  });

  it.each([
    [
      "charges on the side units arrive in",
      { direction: "in", charges: [{ kind: "tax", label: null, amount: "1" }] },
    ],
    ["a negative cost", { direction: "in", price: "-1" }],
    ["a cost on the side units leave", { direction: "out", price: "400" }],
  ])("refuses %s", (_, change) => {
    expect(movementSchema.safeParse({ ...leg, ...change }).success).toBe(false);
  });

  it("takes units out only on the side they leave", () => {
    const out = movementSchema.parse({ ...leg, direction: "out" });
    const into = movementSchema.parse({ ...leg, direction: "in" });
    expect(takesUnits(out)).toBe(true);
    expect(takesUnits(into)).toBe(false);
    expect(startsHolding(into)).toBe(true);
  });
});

describe("a yield", () => {
  const leg = {
    id: "y1",
    holding_id: "h1",
    operation_id: "op",
    entry_order: 1,
    kind: "yield",
    date: "2026-03-02",
    currency: "USD",
    quantity: "5",
    price: "2",
    rates: ratesOf("2026-03-02"),
  };

  it("reads units earned and lost, at their value that day", () => {
    expect(movementSchema.parse({ ...leg, direction: "in" })).toMatchObject({
      price: "2",
      charges: [],
    });
    expect(movementSchema.parse({ ...leg, direction: "out" })).toMatchObject({
      direction: "out",
    });
  });

  it.each([
    [
      "charges",
      { direction: "in", charges: [{ kind: "tax", label: null, amount: "1" }] },
    ],
    ["no value", { direction: "in", price: undefined }],
    ["a null value", { direction: "in", price: null }],
    ["an unknown key", { direction: "in", broker: "x" }],
  ])("refuses %s", (_, change) => {
    expect(movementSchema.safeParse({ ...leg, ...change }).success).toBe(false);
  });

  it("reads a worthless yield", () => {
    expect(
      movementSchema.safeParse({ ...leg, direction: "in", price: "0" }).success,
    ).toBe(true);
  });

  it("takes units out when lost and never starts a holding", () => {
    const out = movementSchema.parse({ ...leg, direction: "out" });
    const into = movementSchema.parse({ ...leg, direction: "in" });
    expect(takesUnits(out)).toBe(true);
    expect(takesUnits(into)).toBe(false);
    expect(startsHolding(into)).toBe(false);
    expect(isIncome(into.kind)).toBe(false);
  });
});
