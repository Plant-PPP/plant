import { buildFixtures } from "@/lib/prototype/fixtures";

import { exportFiles } from "./prototype-export";
import { freshState, initialState } from "./prototype-store";

const TODAY = "2026-10-12";
const fixtures = buildFixtures(TODAY);
const state = initialState(fixtures, TODAY);

const linesOf = (csv: string) => csv.split("\r\n");
const file = (name: string, from = state) =>
  exportFiles(from)
    .find((each) => each.name === name)!
    .csv();

it("exports one CSV per kind of row the user loaded", () => {
  expect(exportFiles(state).map((each) => each.name)).toEqual([
    "tenencias.csv",
    "movimientos.csv",
    "deudas.csv",
    "cargas.csv",
  ]);
});

it("writes every holding, movement and debt, under a header", () => {
  expect(linesOf(file("tenencias.csv"))).toHaveLength(
    fixtures.holdings.length + 1,
  );
  expect(linesOf(file("movimientos.csv"))).toHaveLength(
    fixtures.movements.length + 1,
  );
  expect(linesOf(file("deudas.csv"))).toHaveLength(
    fixtures.liabilities.length + 1,
  );
  expect(linesOf(file("cargas.csv"))).toEqual([
    "Fecha,Archivo,Cuenta,Estado,Fecha del resumen",
  ]);
});

it("writes amounts as stored, with a point, and kinds in the user's words", () => {
  const holdings = file("tenencias.csv");
  for (const row of fixtures.holdings.slice(0, 5)) {
    expect(holdings).toContain(`,${row.holding.amount},`);
  }
  expect(file("movimientos.csv")).toContain(",Compra,");
});

it("leaves a new user's export with headers only", () => {
  const fresh = freshState(state, "p-new");
  for (const each of exportFiles(fresh)) {
    expect(linesOf(each.csv())).toHaveLength(1);
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
