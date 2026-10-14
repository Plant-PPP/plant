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
