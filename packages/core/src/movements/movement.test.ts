import { adjustment, income, ratesOf, trade } from "./fixtures.test-support";
import {
  isIncome,
  movementSchema,
  startsHolding,
  takesMovements,
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
