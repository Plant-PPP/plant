import type { LiabilityEvent } from "@plant/core";

import { toCsv } from "@/lib/export/csv";
import { EXPORT_KINDS, exportTables } from "@/lib/export/tables";
import { buildFixtures } from "@/lib/prototype/fixtures";

import { freshState, initialState } from "./prototype-store";

const TODAY = "2026-10-12";
const fixtures = buildFixtures(TODAY);
const state = initialState(fixtures, TODAY);

const linesOf = (csv: string) => csv.split("\r\n");
const file = (name: string, from = state) => {
  const table = exportTables(from).find((each) => each.name === name)!;
  return toCsv(table.header, table.rows);
};

it("exports one table per kind of row the user loaded, as the card names them", () => {
  expect(
    exportTables(state).map(({ name, label }) => ({ name, label })),
  ).toEqual(EXPORT_KINDS);
});

it("writes every holding, movement and debt, under a header", () => {
  expect(linesOf(file("tenencias"))).toHaveLength(fixtures.holdings.length + 1);
  expect(linesOf(file("movimientos"))).toHaveLength(
    fixtures.movements.length + 1,
  );
  expect(linesOf(file("deudas"))).toHaveLength(fixtures.liabilities.length + 1);
  expect(linesOf(file("cargas"))).toEqual([
    "Fecha,Archivo,Cuenta,Estado,Fecha del resumen",
  ]);
});

it("writes amounts as stored, with a point, and kinds in the user's words", () => {
  const holdings = file("tenencias");
  for (const row of fixtures.holdings.slice(0, 5)) {
    expect(holdings).toContain(`,${row.holding.amount},`);
  }
  expect(file("movimientos")).toContain(",Compra,");
});

it("leaves a new user's export with headers only", () => {
  const fresh = freshState(state, "p-new");
  for (const each of exportTables(fresh)) {
    expect(each.rows).toEqual([]);
  }
});

describe("a deleted account", () => {
  const fresh = freshState(state, "p-new");

  it("keeps one Principal portfolio and the market data, and nothing else", () => {
    expect(fresh.portfolios).toEqual([{ id: "p-new", name: "Principal" }]);
    expect(fresh.accounts).toEqual([]);
    expect(fresh.holdings).toEqual([]);
    expect(fresh.movements.size).toBe(0);
    expect(fresh.liabilities).toEqual([]);
    expect(fresh.imports).toEqual([]);
    expect(fresh.conversations).toEqual([]);
    expect(fresh.manualPrices).toEqual([]);
    expect(fresh.instruments).toBe(state.instruments);
    expect(fresh.quotes).toBe(state.quotes);
  });
});

it("writes a debt's figures today and its events in the order they apply", () => {
  const debt = {
    id: "d1",
    kind: "mortgage" as const,
    label: "Hipoteca",
    lender: null,
    currency: "ARS" as const,
    uva: true,
    instrument_symbol: null,
    balance: "1000",
    installment: null,
    annual_rate: "0.1",
    installments_left: null,
    next_due_on: null,
    matures_on: null,
    accrues: false,
    opened_on: "2026-01-01",
    anchored_on: "2026-01-01",
  };
  const base = {
    liability_id: "d1",
    cash_holding_id: null,
    takes_cash: false as const,
  };
  const events: LiabilityEvent[] = [
    {
      ...base,
      id: "e1",
      kind: "payment",
      date: "2026-03-02",
      amount: "1000",
      annual_rate: null,
      settles: true,
      created_at: "2026-03-02T10:00:00Z",
    },
    {
      ...base,
      id: "e2",
      kind: "adjustment",
      date: "2026-03-02",
      amount: "1000",
      annual_rate: null,
      settles: false,
      created_at: "2026-03-02T11:00:00Z",
    },
    {
      ...base,
      id: "e3",
      kind: "rate_change",
      date: "2026-03-01",
      amount: null,
      annual_rate: "0.2",
      settles: false,
      created_at: "2026-03-01T10:00:00Z",
    },
  ];
  const withDebt = {
    ...state,
    liabilities: [debt],
    liabilityEvents: new Map([["d1", events]]),
  };
  expect(linesOf(file("eventos-de-deudas", withDebt)).slice(1)).toEqual([
    "Hipoteca,2026-03-01,Cambio de tasa,UVA,,0.2,No",
    "Hipoteca,2026-03-02,Ajuste de saldo,UVA,1000,,No",
    "Hipoteca,2026-03-02,Pago,UVA,1000,,Sí",
  ]);
  expect(file("deudas", withDebt)).toContain(",0,1000,2026-01-01,No,,0.2,0.1,");
});
