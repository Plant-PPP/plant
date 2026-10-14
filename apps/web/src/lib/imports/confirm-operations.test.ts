import {
  ACCOUNT,
  emptyLedger,
  PORTFOLIO,
} from "@/lib/ledger/ledger-fixture.test-support";

import { heldOn } from "./confirm";
import { writeImportOperations } from "./confirm-operations";
import type { ImportOperationRow } from "./review";

const ITEM = {
  id: "i1",
  accountId: ACCOUNT,
  date: "2026-09-15",
  fileName: "comprobante.pdf",
};

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
  reference: null,
  currency: "ARS",
  confidence: "high",
  source: "Página 1",
  discarded: false,
  ...extra,
});

let next = 0;
const newId = () =>
  `0e000000-0000-4000-8000-${String(++next).padStart(12, "0")}`;

it("writes a purchase and a later sale of a new instrument, in order", () => {
  const written = writeImportOperations(
    emptyLedger(),
    ITEM,
    [
      row("sale", { kind: "sale", quantity: "2", date: "2026-09-17" }),
      row("buy", { charges: "120.5", reference: "123" }),
    ],
    newId,
  );
  expect(written.result).toEqual({ ok: true, id: "i1" });
  expect(written.operations).toHaveLength(2);
  expect(heldOn(written.state, ACCOUNT, "2026-09-17")).toEqual(
    new Map([["AAPL", "3"]]),
  );
  const movements = [...written.state.movements.values()].flat();
  expect(movements.map((each) => [each.kind, each.date])).toEqual([
    ["purchase", "2026-09-15"],
    ["sale", "2026-09-17"],
  ]);
  expect(movements[0]).toMatchObject({
    reference: "123",
    charges: [
      { kind: "other", label: "Gastos del comprobante", amount: "120.5" },
    ],
  });
  expect(
    written.state.holdings.every((each) => each.portfolioId === PORTFOLIO),
  ).toBe(true);
});

it("puts a day's purchase before that day's sale, whatever the order read", () => {
  const written = writeImportOperations(
    emptyLedger(),
    ITEM,
    [row("sale", { kind: "sale", quantity: "5" }), row("buy")],
    newId,
  );
  expect(written.result).toEqual({ ok: true, id: "i1" });
});

it("refuses a sale of more units than the account held, naming the row", () => {
  const ledger = emptyLedger();
  const written = writeImportOperations(
    ledger,
    ITEM,
    [
      row("buy"),
      row("sale", { kind: "sale", quantity: "6", date: "2026-09-16" }),
    ],
    newId,
  );
  expect(written).toMatchObject({
    result: { ok: false, code: "oversold" },
    rowId: "sale",
    operations: [],
  });
  expect(written.state).toBe(ledger);
});

it("refuses an income on an instrument the account did not hold", () => {
  const written = writeImportOperations(
    emptyLedger(),
    ITEM,
    [
      row("div", {
        kind: "dividend",
        quantity: null,
        price: null,
        amount: "10",
      }),
    ],
    newId,
  );
  expect(written).toMatchObject({
    result: { ok: false, code: "not_found" },
    rowId: "div",
  });
});

it("books an income on the holding that had the units", () => {
  const written = writeImportOperations(
    emptyLedger(),
    ITEM,
    [
      row("buy"),
      row("div", {
        kind: "dividend",
        quantity: null,
        price: null,
        amount: "10",
        date: "2026-09-18",
      }),
    ],
    newId,
  );
  expect(written.result).toEqual({ ok: true, id: "i1" });
  const movements = [...written.state.movements.values()].flat();
  expect(movements.map((each) => each.kind)).toEqual(["purchase", "dividend"]);
});

it("skips discarded rows and refuses an incomplete one", () => {
  expect(
    writeImportOperations(
      emptyLedger(),
      ITEM,
      [row("buy"), row("x", { discarded: true, symbol: "", kind: null })],
      newId,
    ).result,
  ).toEqual({ ok: true, id: "i1" });
  expect(
    writeImportOperations(
      emptyLedger(),
      ITEM,
      [row("x", { symbol: "" })],
      newId,
    ).result,
  ).toEqual({ ok: false, code: "invalid" });
  expect(
    writeImportOperations(
      emptyLedger(),
      ITEM,
      [row("x", { discarded: true })],
      newId,
    ).result,
  ).toEqual({ ok: false, code: "invalid" });
});

it("books an income paid after the units left on the holding that had them", () => {
  const written = writeImportOperations(
    emptyLedger(),
    ITEM,
    [
      row("buy"),
      row("sale", { kind: "sale", date: "2026-09-16" }),
      row("div", {
        kind: "dividend",
        quantity: null,
        price: null,
        amount: "10",
        date: "2026-09-18",
      }),
    ],
    newId,
  );
  expect(written.result).toEqual({ ok: true, id: "i1" });
});
