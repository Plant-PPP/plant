import { instrumentIndex } from "@plant/core";

import { writeOperation } from "@/lib/ledger/ledger";
import { ACCOUNT, emptyLedger } from "@/lib/ledger/ledger-fixture.test-support";

import { planStatement, type StatementRow } from "./statement";

const row = (fields: Partial<StatementRow>): StatementRow => ({
  number: "1",
  kind: "deposit",
  symbol: null,
  date: "2026-09-15",
  quantity: null,
  price: null,
  commission: "0",
  vat: "0",
  otherTaxes: "0",
  amount: "0",
  currency: "USD",
  ...fields,
});

// An account that bought 10 AAPL on 2026-09-15 under number 501.
function ledger() {
  const base = emptyLedger();
  const written = writeOperation(
    {
      ...base,
      quotes: {
        ...base.quotes,
        fxRates: (["mep", "ccl", "official"] as const).map((kind) => ({
          kind,
          rate_date: "2026-09-15",
          sell: "1000",
        })),
      },
    },
    {
      kind: "purchase",
      source_connection_id: ACCOUNT,
      instrument_symbol: "AAPL",
      date: "2026-09-15",
      currency: "USD",
      price: "10",
      charges: [{ kind: "other", label: "Gastos", amount: "1" }],
      reference: "501",
      note: null,
      parts: [{ portfolio_id: base.portfolios[0]!.id, quantity: "10" }],
    },
    { operationId: "op-501", newId: () => crypto.randomUUID() },
  );
  if (!written.result.ok) throw new Error(JSON.stringify(written.result));
  return written.state;
}

const ROWS: StatementRow[] = [
  row({ number: "900", kind: "deposit", date: "2026-09-10", amount: "500" }),
  row({
    number: "501",
    kind: "purchase",
    symbol: "AAPLD",
    quantity: "10",
    price: "10",
    commission: "0.8",
    vat: "0.2",
    amount: "-101",
  }),
  row({
    number: "501",
    kind: "purchase",
    symbol: "AAPLD",
    quantity: "10",
    price: "10",
    otherTaxes: "150",
    amount: "-150",
    currency: "ARS",
  }),
  row({
    number: "502",
    kind: "purchase",
    symbol: "AAPLD",
    date: "2026-09-20",
    quantity: "5",
    price: "11",
    commission: "0.5",
    amount: "-55.5",
  }),
  row({ number: "601", kind: "dividend", symbol: "AAPL", amount: "0.4" }),
  row({
    number: "602",
    kind: "dividend",
    symbol: "AAPL",
    commission: "2",
    amount: "-2",
    currency: "ARS",
  }),
  row({ number: "700", kind: "credit", date: "2026-10-01", amount: "0.02" }),
  row({ number: "800", kind: "purchase", symbol: "ZZZZ", amount: "-5" }),
];

describe("planStatement", () => {
  const state = ledger();
  const index = instrumentIndex(
    state.instruments.map((each) => ({ ...each, aliases: [] })),
  );

  it("settles the operations it has, creates the rest and opens the cash", () => {
    const plan = planStatement(ROWS, {
      ledger: state,
      accountId: ACCOUNT,
      cash: new Map(),
      index,
    });
    expect(plan.matched).toBe(1);
    expect(plan.skipped).toBe(1);
    expect(plan.create.map((each) => [each.reference, each.symbol])).toEqual([
      ["601", "AAPL"],
      ["502", "AAPL"],
    ]);
    expect(plan.create[0]).toMatchObject({ kind: "dividend", amount: "0.4" });
    expect(plan.create[1]).toMatchObject({
      kind: "purchase",
      quantity: "5",
      price: "11",
      charges: "0.5",
      currency: "USD",
    });
    expect(plan.cash.get("USD")).toEqual([
      expect.objectContaining({
        kind: "deposit",
        amount: "500",
        operation: null,
      }),
      expect.objectContaining({ kind: "income", amount: "0.02" }),
      expect.objectContaining({
        kind: "settlement",
        amount: "-101",
        operation: { id: "op-501" },
      }),
      expect.objectContaining({
        kind: "settlement",
        amount: "-55.5",
        operation: { number: "502" },
      }),
      expect.objectContaining({
        kind: "settlement",
        amount: "0.4",
        operation: { number: "601" },
      }),
    ]);
    expect(plan.cash.get("ARS")).toEqual([
      expect.objectContaining({
        kind: "settlement",
        amount: "-150",
        operation: { id: "op-501" },
      }),
      expect.objectContaining({
        kind: "charge",
        amount: "-2",
        operation: null,
      }),
    ]);
    // What the cash holds today (none) less what the statement adds.
    expect(plan.openings.get("USD")).toEqual({
      date: "2026-09-10",
      amount: "-343.92",
    });
    expect(plan.openings.get("ARS")).toEqual({
      date: "2026-09-10",
      amount: "152",
    });
  });

  it("adds nothing a currency's history already has", () => {
    const first = planStatement(ROWS, {
      ledger: state,
      accountId: ACCOUNT,
      cash: new Map(),
      index,
    });
    const history = [
      ...first.cash.get("USD")!.map((each, position) => ({
        id: `m${position}`,
        holding_id: "cash",
        operation_id:
          each.operation && "id" in each.operation ? each.operation.id : null,
        kind: each.kind,
        date: each.date,
        amount: each.amount,
        reference: each.reference,
        note: null,
        rates: {
          mep: { sell: "1000", date: "2026-09-15" },
          ccl: { sell: "1000", date: "2026-09-15" },
          official: { sell: "1000", date: "2026-09-15" },
        },
      })),
    ];
    const again = planStatement(ROWS, {
      ledger: state,
      accountId: ACCOUNT,
      cash: new Map([["USD", { holdingId: "cash", today: "0", history }]]),
      index,
    });
    expect(again.openings.has("USD")).toBe(false);
    expect(again.cash.get("USD")?.map((each) => each.reference)).toEqual([
      "502",
      "601",
    ]);
  });

  it("settles a sync's cash against the operations Plant has only", () => {
    const plan = planStatement(ROWS, {
      ledger: state,
      accountId: ACCOUNT,
      cash: new Map(),
      index,
      create: false,
      given: [{ currency: "USD", date: "2026-09-01", amount: "1000" }],
    });
    expect(plan.create).toEqual([]);
    expect(plan.matched).toBe(1);
    expect(plan.skipped).toBe(2);
    expect(
      plan.cash.get("USD")?.map((each) => [each.reference, each.kind]),
    ).toEqual([
      ["900", "deposit"],
      ["700", "income"],
      ["501", "settlement"],
      ["601", "income"],
    ]);
    expect(plan.openings.get("USD")).toEqual({
      date: "2026-09-01",
      amount: "1000",
    });
    // A currency the provider gave no balance for opens as a statement does.
    expect(plan.openings.get("ARS")).toEqual({
      date: "2026-09-10",
      amount: "152",
    });
  });
});
