import {
  emptyLedger,
  ACCOUNT,
  PORTFOLIO,
} from "@/lib/ledger/ledger-fixture.test-support";

import { heldOn, writeImport } from "./confirm";

const row = (symbol: string, quantity: string, price: string | null) => ({
  id: symbol,
  symbol,
  quantity,
  price,
  currency: "ARS" as const,
  confidence: "high" as const,
  source: "Página 1",
  discarded: false,
});

const ITEM = {
  id: "i1",
  accountId: ACCOUNT,
  date: "2026-09-15",
  fileName: "resumen.pdf",
};

let next = 0;
const newId = () =>
  `0f000000-0000-4000-8000-${String(++next).padStart(12, "0")}`;

it("writes one operation per instrument that changes, in order", () => {
  const ledger = {
    ...emptyLedger(),
    instruments: [
      ...emptyLedger().instruments,
      {
        symbol: "KO",
        name: "Coca-Cola",
        currency: "ARS" as const,
        type: "cedear" as const,
      },
    ],
  };
  const written = writeImport(
    ledger,
    ITEM,
    [row("AAPL", "5", "18000"), row("KO", "3", "9000")],
    newId,
  );
  expect(written.result).toEqual({ ok: true, id: "i1" });
  expect(written.operations).toHaveLength(2);
  expect(heldOn(written.state, ACCOUNT, "2026-09-15")).toEqual(
    new Map([
      ["AAPL", "5"],
      ["KO", "3"],
    ]),
  );
  const movements = [...written.state.movements.values()].flat();
  expect(movements.map((each) => each.operation_id)).toEqual(
    written.operations,
  );
  expect(
    written.state.holdings.every((each) => each.portfolioId === PORTFOLIO),
  ).toBe(true);
});

it("writes nothing and names no operation when a row is refused", () => {
  const ledger = emptyLedger();
  const written = writeImport(
    ledger,
    ITEM,
    [row("AAPL", "5", "18000"), row("NOPE", "1", "1")],
    newId,
  );
  expect(written.result).toEqual({ ok: false, code: "not_found" });
  expect(written.operations).toEqual([]);
  expect(written.state).toBe(ledger);
});

it("refuses an account the user does not have", () => {
  expect(
    writeImport(emptyLedger(), { ...ITEM, accountId: "x" }, [], newId).result,
  ).toEqual({ ok: false, code: "not_found" });
});
