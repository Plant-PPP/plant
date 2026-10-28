import {
  ACCOUNT,
  emptyLedger,
  PORTFOLIO,
} from "@/lib/ledger/ledger-fixture.test-support";

import { writeImportOperations } from "./confirm-operations";
import {
  markLoaded,
  markPaymentsLoaded,
  withoutLoaded,
} from "./operations-loaded";
import type { ImportOperationRow } from "./review";

const row = (
  id: string,
  extra: Partial<ImportOperationRow> = {},
): ImportOperationRow => ({
  id,
  date: "2026-09-15",
  kind: "purchase",
  symbol: "AAPL",
  quantity: "5",
  price: "18000",
  amount: null,
  charges: null,
  reference: "123",
  currency: "ARS",
  confidence: "high",
  source: "Página 1",
  discarded: false,
  ...extra,
});

let next = 0;
const newId = () =>
  `0d000000-0000-4000-8000-${String(++next).padStart(12, "0")}`;

const BINGX = "b5000000-0000-4000-8000-0000000000b5";

// The user with a second account, at the same portfolio.
function twoAccounts() {
  const ledger = emptyLedger();
  return {
    ...ledger,
    accounts: [
      ...ledger.accounts,
      {
        id: BINGX,
        institution: "BingX",
        includeInTaxReport: true,
        portfolio: { id: PORTFOLIO, name: "Principal", archived: false },
      },
    ],
  };
}

// The account after these operations were confirmed once.
const after = (rows: ImportOperationRow[]) =>
  writeImportOperations(
    twoAccounts(),
    { id: "i1", accountId: ACCOUNT, date: "2026-09-15", fileName: "a.pdf" },
    rows,
    newId,
  ).state;

const loaded = (
  state: ReturnType<typeof after>,
  rows: ImportOperationRow[],
  accountId = ACCOUNT,
) => markLoaded(state, accountId, rows).map((each) => each.loaded ?? false);

it("finds an operation the account has by its number, kind and instrument", () => {
  const state = after([row("buy")]);
  expect(loaded(state, [row("x", { quantity: "9" })])).toEqual([true]);
  // The same number on another kind is another document's.
  expect(
    loaded(state, [
      row("x", { kind: "dividend", quantity: null, price: null, amount: "1" }),
    ]),
  ).toEqual([false]);
});

it("finds one by its day, kind, instrument and units when it has no number", () => {
  const state = after([row("buy")]);
  expect(loaded(state, [row("x", { reference: null })])).toEqual([true]);
  expect(loaded(state, [row("x", { reference: null, quantity: "6" })])).toEqual(
    [false],
  );
});

it("adds up an operation's parts across portfolios", () => {
  const state = after([row("buy", { quantity: "10", reference: null })]);
  expect(
    loaded(state, [row("x", { reference: null, quantity: "10" })]),
  ).toEqual([true]);
});

it("takes one loaded operation for one row only", () => {
  const state = after([row("buy", { reference: null })]);
  expect(
    loaded(state, [
      row("a", { reference: null }),
      row("b", { reference: null }),
    ]),
  ).toEqual([true, false]);
});

it("looks only in the account the document was uploaded to", () => {
  expect(loaded(after([row("buy")]), [row("x")], "another")).toEqual([false]);
});

it("sets aside the operations already loaded", () => {
  expect(
    markLoaded(after([row("buy")]), ACCOUNT, [
      row("old"),
      row("new", { reference: "999", date: "2026-09-16" }),
    ]).map(({ id, discarded, loaded }) => [id, discarded, loaded ?? false]),
  ).toEqual([
    ["old", true, true],
    ["new", false, false],
  ]);
});

it("discards on confirm a numbered operation the account already holds, even one the review kept", () => {
  const state = after([row("buy")]);
  const kept = withoutLoaded(state, ACCOUNT, [
    row("again", { quantity: "9" }),
    row("other", { reference: "456" }),
    row("unnumbered", { reference: null }),
  ]);
  expect(kept.map((each) => [each.id, each.discarded])).toEqual([
    ["again", true],
    ["other", false],
    // With no number, the user decides whether it is the same one.
    ["unnumbered", false],
  ]);
});

const withdrawal = (id: string, extra: Partial<ImportOperationRow> = {}) =>
  row(id, {
    kind: "adjustment",
    direction: "out",
    quantity: "2",
    price: null,
    reference: null,
    date: "2026-09-16",
    ...extra,
  });

it("finds a withdrawal in the units a transfer took out, and not in units that came in", () => {
  const state = after([
    row("buy", { reference: null }),
    withdrawal("send", { kind: "transfer", counterpartId: BINGX }),
  ]);
  expect(loaded(state, [withdrawal("x")])).toEqual([true]);
  expect(loaded(state, [withdrawal("x", { direction: "in" })])).toEqual([
    false,
  ]);
  // The account the units went to holds them as a deposit.
  expect(loaded(state, [withdrawal("x", { direction: "in" })], BINGX)).toEqual([
    true,
  ]);
});

it("finds a transfer in the units a withdrawal took out", () => {
  const state = after([row("buy", { reference: null }), withdrawal("out")]);
  expect(
    loaded(state, [
      withdrawal("x", { kind: "transfer", counterpartId: BINGX }),
    ]),
  ).toEqual([true]);
});

it("finds a withdrawal by its transaction number", () => {
  const state = after([
    row("buy", { reference: null }),
    withdrawal("out", { reference: "tx-1" }),
  ]);
  expect(
    loaded(state, [withdrawal("x", { reference: "tx-1", quantity: "9" })]),
  ).toEqual([true]);
});

it("sets aside a payment its debt already has, once", () => {
  const payment = (id: string, extra: Partial<ImportOperationRow> = {}) =>
    row(id, {
      kind: null,
      debtPayment: true,
      payDebtId: "d1",
      quantity: "500",
      price: null,
      reference: null,
      ...extra,
    });
  const marked = markPaymentsLoaded(
    [
      payment("same"),
      payment("again"),
      payment("other day", { date: "2026-09-16" }),
      payment("other debt", { payDebtId: "d2" }),
    ],
    [{ liability_id: "d1", date: "2026-09-15", amount: "500.00000000" }],
  );
  expect(marked.map((each) => each.loaded ?? false)).toEqual([
    true,
    false,
    false,
    false,
  ]);
});
