import { ACCOUNT, emptyLedger } from "@/lib/ledger/ledger-fixture.test-support";

import { writeImportOperations } from "./confirm-operations";
import { markLoaded } from "./operations-loaded";
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

// The account after these operations were confirmed once.
const after = (rows: ImportOperationRow[]) =>
  writeImportOperations(
    emptyLedger(),
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
