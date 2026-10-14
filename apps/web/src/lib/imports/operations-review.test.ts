import type { ImportOperationRow } from "./review";
import { missingFields, operationsComplete } from "./operations-review";

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
  expect(operationsComplete([row({ symbol: "" })], TODAY)).toBe(false);
});
