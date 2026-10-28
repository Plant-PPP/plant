import {
  cardFor,
  debtPaid,
  debtsComplete,
  loanInputOf,
  missingDebtFields,
  type ReviewedDebt,
} from "./debts-review";

const debt = (patch: Partial<ReviewedDebt> = {}): ReviewedDebt => ({
  id: "d1",
  kind: null,
  instrumentSymbol: null,
  annualRate: null,
  accrues: null,
  openedOn: null,
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

it("asks a loan for its unit, and the day of its balance when it accrues", () => {
  const loan = (patch: Partial<ReviewedDebt>) =>
    debt({ kind: "personal_loan", ...patch });
  expect(missingDebtFields(loan({}))).toEqual([]);
  expect(missingDebtFields(loan({ currency: null }))).toEqual(["currency"]);
  expect(
    missingDebtFields(
      loan({ kind: "crypto_loan", currency: null, instrumentSymbol: null }),
    ),
  ).toEqual(["instrumentSymbol"]);
  expect(missingDebtFields(loan({ accrues: true }))).toEqual(["openedOn"]);
  expect(
    missingDebtFields(loan({ accrues: true, openedOn: "2026-10-01" })),
  ).toEqual([]);
});

it("makes a loan the debt Deudas stores, with no installment when it accrues", () => {
  const made = loanInputOf(
    debt({
      kind: "usd_debt",
      currency: "USD",
      minimumPayment: "100",
      dueDate: "2026-11-01",
      annualRate: "0.139",
      accrues: true,
      openedOn: "2026-10-01",
    }),
  );
  expect(made.data).toMatchObject({
    kind: "usd_debt",
    currency: "USD",
    installment: null,
    next_due_on: null,
    annual_rate: "0.139",
    accrues: true,
    opened_on: "2026-10-01",
  });
  expect(loanInputOf(debt({ kind: "usd_debt", currency: "ARS" })).success).toBe(
    false,
  );
});

it("never proposes a card debt for a loan", () => {
  const cards = [{ id: "c1", label: "Visa", lender: null, currency: "ARS" }];
  expect(cardFor(debt({ kind: "personal_loan" }), cards)).toBeNull();
});

describe("debtPaid", () => {
  const debt = (
    id: string,
    extra: Partial<Parameters<typeof debtPaid>[2][number]> = {},
  ) => ({
    id,
    label: "Préstamo",
    lender: null,
    currency: "USD",
    uva: false,
    instrument_symbol: null,
    ...extra,
  });

  it("picks the debt in the repayment's unit named as the account, else the only one", () => {
    const line = debt("line", { lender: "Exchange A" });
    const other = debt("other", { lender: "Banco" });
    expect(debtPaid("USD", "Exchange A", [line, other])?.id).toBe("line");
    expect(debtPaid("USD", "Exchange B", [line])?.id).toBe("line");
    expect(debtPaid("USD", "Exchange B", [line, other])).toBeNull();
  });

  it("never takes a UVA debt for a peso repayment, nor a crypto loan for its currency", () => {
    const mortgage = debt("uva", { currency: "ARS", uva: true });
    const crypto = debt("btc", { currency: null, instrument_symbol: "BTC" });
    expect(debtPaid("ARS", "Banco", [mortgage])).toBeNull();
    expect(debtPaid("UVA", "Banco", [mortgage])?.id).toBe("uva");
    expect(debtPaid("BTC", "Exchange A", [crypto])?.id).toBe("btc");
    expect(debtPaid("USD", "Exchange A", [crypto])).toBeNull();
  });
});
