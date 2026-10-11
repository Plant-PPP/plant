import { ratesOf } from "./fixtures.test-support";
import {
  allowedKinds,
  isIncome,
  movementSchema,
  takesMovements,
} from "./movement";

const purchase = {
  id: "m1",
  holding_id: "h1",
  kind: "purchase",
  date: "2026-03-02",
  currency: "USD",
  quantity: "10",
  price: "150.5",
  rates: ratesOf("2026-03-02"),
};

describe("movementSchema", () => {
  it("reads a purchase, with no fees or taxes by default", () => {
    expect(movementSchema.parse(purchase)).toMatchObject({
      fees: "0",
      taxes: "0",
    });
  });

  it.each([
    ["a negative fee", { ...purchase, fees: "-1" }],
    [
      "a sale without quantity",
      { ...purchase, kind: "sale", quantity: undefined },
    ],
    [
      "a dividend with a quantity",
      { ...purchase, kind: "dividend", amount: "5" },
    ],
    ["a zero quantity", { ...purchase, quantity: "0" }],
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
    const { id, holding_id, date, currency, rates } = purchase;
    const dividend = { id, holding_id, date, currency, rates, amount: "12" };
    expect(
      movementSchema.parse({ ...dividend, kind: "dividend" }),
    ).toMatchObject({ kind: "dividend", amount: "12" });
  });
});

it("opens a holding with its balance, then takes anything else", () => {
  expect(allowedKinds(false)).toEqual(["opening_balance"]);
  expect(allowedKinds(true)).toEqual([
    "purchase",
    "sale",
    "dividend",
    "coupon",
  ]);
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
