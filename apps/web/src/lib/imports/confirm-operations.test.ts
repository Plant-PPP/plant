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

it("brings a deposit's units in before that day's sale of them", () => {
  const written = writeImportOperations(
    emptyLedger(),
    ITEM,
    [
      row("sale", { kind: "sale", quantity: "3" }),
      row("deposit", { kind: "adjustment", quantity: "5", price: "17000" }),
    ],
    newId,
  );
  expect(written.result).toEqual({ ok: true, id: "i1" });
  const movements = [...written.state.movements.values()].flat();
  expect(movements.map((each) => each.kind)).toEqual(["adjustment", "sale"]);
  expect(movements[0]).toMatchObject({
    direction: "in",
    quantity: "5",
    price: "17000",
  });
  expect(heldOn(written.state, ACCOUNT, "2026-09-15")).toEqual(
    new Map([["AAPL", "2"]]),
  );
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

it("takes a withdrawal's units out of the account", () => {
  const written = writeImportOperations(
    emptyLedger(),
    ITEM,
    [
      row("buy"),
      row("out", {
        kind: "adjustment",
        direction: "out",
        quantity: "2",
        price: null,
        date: "2026-09-16",
      }),
    ],
    newId,
  );
  expect(written.result).toEqual({ ok: true, id: "i1" });
  const movements = [...written.state.movements.values()].flat();
  expect(movements[1]).toMatchObject({
    kind: "adjustment",
    direction: "out",
    quantity: "2",
  });
  expect(heldOn(written.state, ACCOUNT, "2026-09-16")).toEqual(
    new Map([["AAPL", "3"]]),
  );
});

it("refuses a withdrawal of more units than the account held", () => {
  const written = writeImportOperations(
    emptyLedger(),
    ITEM,
    [
      row("buy"),
      row("out", {
        kind: "adjustment",
        direction: "out",
        quantity: "6",
        price: null,
        date: "2026-09-16",
      }),
    ],
    newId,
  );
  expect(written).toMatchObject({
    result: { ok: false, code: "oversold" },
    rowId: "out",
  });
});

it("moves a transfer's units to the other account, its fee on the leaving side", () => {
  const written = writeImportOperations(
    twoAccounts(),
    ITEM,
    [
      row("buy"),
      row("send", {
        kind: "transfer",
        direction: "out",
        counterpartId: BINGX,
        quantity: "4",
        price: null,
        charges: "1.5",
        date: "2026-09-16",
      }),
    ],
    newId,
  );
  expect(written.result).toEqual({ ok: true, id: "i1" });
  expect(written.operations).toHaveLength(2);
  expect(heldOn(written.state, ACCOUNT, "2026-09-16")).toEqual(
    new Map([["AAPL", "1"]]),
  );
  expect(heldOn(written.state, BINGX, "2026-09-16")).toEqual(
    new Map([["AAPL", "4"]]),
  );
  const leaving = [...written.state.movements.values()]
    .flat()
    .find((each) => "direction" in each && each.direction === "out");
  expect(leaving).toMatchObject({
    kind: "transfer",
    charges: [{ amount: "1.5" }],
  });
});

it("refuses a transfer to an account that is not open or is the import's own", () => {
  for (const counterpartId of [
    "c5000000-0000-4000-8000-0000000000c5",
    ACCOUNT,
  ]) {
    const written = writeImportOperations(
      twoAccounts(),
      ITEM,
      [
        row("buy"),
        row("send", {
          kind: "transfer",
          direction: "out",
          counterpartId,
          quantity: "4",
          price: null,
          date: "2026-09-16",
        }),
      ],
      newId,
    );
    expect(written).toMatchObject({
      result: { ok: false, code: "counterpart_not_found" },
      rowId: "send",
      operations: [],
    });
  }
});

it("refuses a transfer whose units the other account already shows coming in", () => {
  const deposited = writeImportOperations(
    twoAccounts(),
    { ...ITEM, accountId: BINGX },
    [
      row("deposit", {
        kind: "adjustment",
        direction: "in",
        quantity: "4",
        date: "2026-09-16",
      }),
    ],
    newId,
  ).state;
  const written = writeImportOperations(
    deposited,
    ITEM,
    [
      row("buy"),
      row("send", {
        kind: "transfer",
        direction: "out",
        counterpartId: BINGX,
        quantity: "4",
        price: null,
        date: "2026-09-16",
      }),
    ],
    newId,
  );
  expect(written).toMatchObject({
    result: { ok: false, code: "already_loaded" },
    rowId: "send",
  });
});

describe("debt payments", () => {
  const LOAN = {
    id: "d1",
    currency: null,
    uva: false,
    instrument_symbol: "AAPL",
  };
  const DOLLARS = {
    id: "d2",
    currency: "USD" as const,
    uva: false,
    instrument_symbol: null,
  };
  const UVA = {
    id: "d3",
    currency: "ARS" as const,
    uva: true,
    instrument_symbol: null,
  };
  const payable = {
    debts: [LOAN, DOLLARS, UVA],
    cash: [
      { id: "c1", accountId: ACCOUNT, currency: "USD" as const, amount: "800" },
    ],
  };
  const payment = (id: string, extra: Partial<ImportOperationRow> = {}) =>
    row(id, {
      kind: null,
      debtPayment: true,
      payDebtId: "d2",
      symbol: "",
      quantity: "100",
      price: null,
      date: "2026-09-16",
      ...extra,
    });
  const event = (date: string, amount: string) => ({
    kind: "payment",
    date,
    amount,
    annual_rate: null,
    settles: false,
  });

  it("pays a debt on its own, with nothing out of the account", () => {
    const written = writeImportOperations(
      emptyLedger(),
      ITEM,
      [payment("paid")],
      newId,
      payable,
    );
    expect(written.result).toEqual({ ok: true, id: "i1" });
    expect(written.operations).toEqual([]);
    expect(written.payments).toEqual([
      { liability_id: "d2", event: event("2026-09-16", "100"), cash: null },
    ]);
  });

  it("pays a crypto loan with the units that left the account", () => {
    const written = writeImportOperations(
      emptyLedger(),
      ITEM,
      [
        row("buy"),
        payment("paid", {
          kind: "adjustment",
          direction: "out",
          payDebtId: "d1",
          quantity: "2",
        }),
      ],
      newId,
      payable,
    );
    expect(written.result).toEqual({ ok: true, id: "i1" });
    expect(heldOn(written.state, ACCOUNT, "2026-09-16")).toEqual(
      new Map([["AAPL", "3"]]),
    );
    expect(written.payments).toEqual([
      { liability_id: "d1", event: event("2026-09-16", "2"), cash: null },
    ]);
  });

  it("pays a debt in a currency from the account's one cash holding in it", () => {
    const written = writeImportOperations(
      emptyLedger(),
      ITEM,
      [payment("paid", { kind: "adjustment", direction: "out" })],
      newId,
      payable,
    );
    expect(written.payments).toEqual([
      {
        liability_id: "d2",
        event: event("2026-09-16", "100"),
        cash: { holding_id: "c1", take: true, expected: "800" },
      },
    ]);
    expect(
      writeImportOperations(
        emptyLedger(),
        ITEM,
        [payment("paid", { kind: "adjustment", direction: "out" })],
        newId,
        { ...payable, cash: [] },
      ),
    ).toMatchObject({ result: { ok: false, code: "no_cash" }, rowId: "paid" });
  });

  it("refuses a debt it may not pay, and a UVA debt from the account's cash", () => {
    expect(
      writeImportOperations(
        emptyLedger(),
        ITEM,
        [payment("paid", { payDebtId: "card" })],
        newId,
        payable,
      ),
    ).toMatchObject({
      result: { ok: false, code: "debt_not_found" },
      rowId: "paid",
      payments: [],
    });
    expect(
      writeImportOperations(
        emptyLedger(),
        ITEM,
        [
          payment("paid", {
            kind: "adjustment",
            direction: "out",
            payDebtId: "d3",
          }),
        ],
        newId,
        payable,
      ),
    ).toMatchObject({ result: { ok: false, code: "no_cash_link" } });
  });
});
