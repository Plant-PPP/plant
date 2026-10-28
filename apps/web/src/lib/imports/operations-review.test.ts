import type { ImportOperationRow } from "./review";
import {
  keptCounts,
  missingFields,
  operationsComplete,
} from "./operations-review";

const TODAY = "2026-10-14";

const row = (extra: Partial<ImportOperationRow> = {}): ImportOperationRow => ({
  id: "o1",
  date: "2026-09-01",
  kind: "purchase",
  symbol: "GGAL",
  quantity: "100",
  price: "5000",
  amount: null,
  charges: null,
  reference: null,
  currency: "ARS",
  confidence: "high",
  source: "Página 1",
  discarded: false,
  ...extra,
});

it("asks a trade for its date, kind, instrument, units and price", () => {
  expect(missingFields(row(), TODAY)).toEqual([]);
  expect(
    missingFields(
      row({ date: null, symbol: "", quantity: null, price: "0" }),
      TODAY,
    ),
  ).toEqual(["date", "symbol", "quantity", "price"]);
});

it("asks an income for its amount, not units", () => {
  expect(
    missingFields(
      row({ kind: "dividend", quantity: null, price: null }),
      TODAY,
    ),
  ).toEqual(["amount"]);
  expect(
    missingFields(
      row({ kind: "coupon", quantity: null, price: null, amount: "12.5" }),
      TODAY,
    ),
  ).toEqual([]);
});

it("asks for the kind before the figures, and refuses a later date", () => {
  expect(
    missingFields(
      row({ kind: null, quantity: null, date: "2026-10-15" }),
      TODAY,
    ),
  ).toEqual(["date", "kind"]);
});

it("is complete when every kept operation is, and one is kept", () => {
  expect(
    operationsComplete([row(), row({ discarded: true, symbol: "" })], TODAY),
  ).toBe(true);
  expect(operationsComplete([row({ discarded: true })], TODAY)).toBe(false);
  expect(operationsComplete([row({ discarded: true })], TODAY, true)).toBe(
    true,
  );
  expect(operationsComplete([row({ symbol: "" })], TODAY)).toBe(false);
});

it("asks a withdrawal for its units and a transfer also for the account", () => {
  const out = {
    kind: "adjustment" as const,
    price: null,
    direction: "out" as const,
  };
  expect(missingFields(row({ ...out, quantity: null }), TODAY)).toEqual([
    "quantity",
  ]);
  expect(
    missingFields(
      row({ ...out, kind: "transfer", counterpartId: null }),
      TODAY,
    ),
  ).toEqual(["counterpart"]);
});

it("counts what the kept operations move and those the account already held", () => {
  const reviewed = [
    row({ id: "send", kind: "transfer", direction: "out" }),
    row({ id: "out", kind: "adjustment", direction: "out" }),
    row({ id: "in", kind: "adjustment", direction: "in" }),
    row({ id: "held" }),
    row({ id: "dropped", discarded: true }),
  ];
  const toWrite = reviewed.map((each) =>
    each.id === "held" ? { ...each, discarded: true } : each,
  );
  expect(keptCounts(reviewed, toWrite)).toEqual({
    transfers: 1,
    unitsOut: 1,
    loaded: 1,
  });
});
