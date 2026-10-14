import { ACCOUNT, emptyLedger } from "@/lib/ledger/ledger-fixture.test-support";

import { writeImportOperations } from "./confirm-operations";
import { alreadyLoaded, markLoaded } from "./operations-loaded";
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

// The account after a ticket was confirmed once.
const confirmed = writeImportOperations(
  emptyLedger(),
  { id: "i1", accountId: ACCOUNT, date: "2026-09-15", fileName: "a.pdf" },
  [row("buy")],
  newId,
).state;

it("finds an operation the account has by its number", () => {
  expect(alreadyLoaded(confirmed, ACCOUNT, row("x", { quantity: "9" }))).toBe(
    true,
  );
});

it("finds one by its day, kind, instrument and units when it has no number", () => {
  expect(alreadyLoaded(confirmed, ACCOUNT, row("x", { reference: null }))).toBe(
    true,
  );
  expect(
    alreadyLoaded(
      confirmed,
      ACCOUNT,
      row("x", { reference: null, quantity: "6" }),
    ),
  ).toBe(false);
  expect(
    alreadyLoaded(
      confirmed,
      ACCOUNT,
      row("x", { reference: null, kind: "sale" }),
    ),
  ).toBe(false);
});

it("looks only in the account the document was uploaded to", () => {
  expect(alreadyLoaded(confirmed, "another", row("x"))).toBe(false);
});

it("sets aside the operations already loaded", () => {
  expect(
    markLoaded(confirmed, ACCOUNT, [
      row("old"),
      row("new", { reference: "999", date: "2026-09-16" }),
    ]).map(({ id, discarded, loaded }) => [id, discarded, loaded ?? false]),
  ).toEqual([
    ["old", true, true],
    ["new", false, false],
  ]);
});
