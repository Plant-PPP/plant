import {
  cardFor,
  debtsComplete,
  missingDebtFields,
  type ReviewedDebt,
} from "./debts-review";

const debt = (patch: Partial<ReviewedDebt> = {}): ReviewedDebt => ({
  id: "d1",
  label: "Visa",
  lender: "Galicia",
  currency: "ARS",
  balance: "250000.5",
  minimumPayment: null,
  dueDate: null,
  confidence: "high",
  source: "Página 1",
  discarded: false,
  liabilityId: null,
  ...patch,
});

it("asks for a debt's name and balance, never its minimum or due date", () => {
  expect(missingDebtFields(debt())).toEqual([]);
  expect(missingDebtFields(debt({ label: " ", balance: null }))).toEqual([
    "label",
    "balance",
  ]);
  expect(missingDebtFields(debt({ balance: "0" }))).toEqual(["balance"]);
  expect(missingDebtFields(debt({ label: null, liabilityId: "c1" }))).toEqual(
    [],
  );
  expect(missingDebtFields(debt({ discarded: true, balance: null }))).toEqual(
    [],
  );
});

it("confirms only with a complete debt kept", () => {
  expect(debtsComplete([debt()])).toBe(true);
  expect(debtsComplete([debt({ discarded: true })])).toBe(false);
  expect(debtsComplete([debt(), debt({ id: "d2", balance: null })])).toBe(
    false,
  );
});

it("names the user's card debt in the same currency by its name or bank", () => {
  const cards = [
    { id: "c1", label: "VISA", lender: null, currency: "ARS" },
    { id: "c2", label: "Visa", lender: null, currency: "USD" },
    { id: "c3", label: "Master", lender: "Macro", currency: "ARS" },
  ];
  expect(cardFor(debt(), cards)).toBe("c1");
  expect(cardFor(debt({ currency: "USD" }), cards)).toBe("c2");
  expect(cardFor(debt({ label: "Amex", lender: null }), cards)).toBeNull();
  expect(
    cardFor(debt(), [
      ...cards,
      { id: "c4", label: "Galicia", lender: null, currency: "ARS" },
    ]),
  ).toBeNull();
});
