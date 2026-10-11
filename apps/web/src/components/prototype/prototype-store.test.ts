import { compareMovements } from "@plant/core";
import { addDays } from "@plant/shared";

import { buildFixtures } from "@/lib/prototype/fixtures";

import {
  allRows,
  createHolding,
  holdingsView,
  initialState,
  movementsPage,
  positionsOf,
  salesOf,
  updateHolding,
  writeMovement,
  yearsOf,
} from "./prototype-store";

const TODAY = "2026-10-12";
const fixtures = buildFixtures(TODAY);
const state = initialState(fixtures, TODAY);
const NO_FILTER = { portfolioId: null, assetClass: null, search: "" };
const NAMES = new Map(fixtures.instruments.map((i) => [i.symbol, i.name]));

const idOf = (symbol: string) =>
  fixtures.holdings.find(
    (row) =>
      row.holding.asset_class === "instrument" &&
      row.holding.instrument_symbol === symbol,
  )!.id;
const AAPL = idOf("AAPL");
const AL30D = idOf("AL30D");
const BTC = idOf("BTC");
const CASH = fixtures.holdings.find(
  (row) => row.holding.asset_class === "cash",
)!.id;
const NEW_ID = "e1000000-0000-4000-8000-000000000001";

const sale = (quantity: string, date = TODAY) => ({
  holding_id: AAPL,
  kind: "sale",
  date,
  currency: "ARS",
  quantity,
  price: "18000",
});

describe("holdings", () => {
  it("lists open holdings and leaves the closed one out", () => {
    const shown = holdingsView(state).active.map((row) => row.id);
    expect(shown).not.toContain(AL30D);
    expect(shown).toContain(AAPL);
    expect(allRows(state).map((row) => row.id)).toContain(AL30D);
  });

  it("creates a holding in an account and portfolio it has", () => {
    const input = {
      asset_class: "cash",
      source_connection_id: fixtures.accounts[0]!.id,
      portfolio_id: fixtures.portfolios[0]!.id,
      amount: "100",
      currency: "USD",
      instrument_symbol: null,
      annual_rate: null,
      started_on: null,
      matures_on: null,
      valued_on: null,
      label: null,
    };
    const created = createHolding(state, input, NEW_ID);
    expect(created.result).toEqual({ ok: true, id: NEW_ID });
    expect(holdingsView(created.state).active[0]!.id).toBe(NEW_ID);
    expect(
      createHolding(state, { ...input, portfolio_id: NEW_ID }, NEW_ID).result,
    ).toEqual({ ok: false, code: "not_found" });
    expect(
      createHolding(state, { ...input, amount: "-1" }, NEW_ID).result,
    ).toEqual({ ok: false, code: "invalid" });
  });

  it("keeps the quantity its movements leave when a holding is edited", () => {
    const edited = updateHolding(state, AAPL, {
      asset_class: "instrument",
      amount: "1",
      currency: null,
      annual_rate: null,
      started_on: null,
      matures_on: null,
      valued_on: null,
      label: null,
    });
    expect(edited.result).toEqual({ ok: true, id: AAPL });
    expect(
      allRows(edited.state).find((row) => row.id === AAPL)!.holding.amount,
    ).toBe(fixtures.holdings.find((row) => row.id === AAPL)!.holding.amount);
  });
});

describe("movements", () => {
  it("records a sale, revises the holding and sets its amount", () => {
    const before = fixtures.holdings.find((row) => row.id === AAPL)!;
    const written = writeMovement(state, sale("1"), { id: NEW_ID });
    expect(written.result).toEqual({ ok: true, id: NEW_ID });
    expect(written.state.revisions.get(AAPL)).toBe(
      state.revisions.get(AAPL)! + 1,
    );
    const after = allRows(written.state).find((row) => row.id === AAPL)!;
    expect(Number(after.holding.amount)).toBe(
      Number(before.holding.amount) - 1,
    );
  });

  it.each([
    ["oversold", sale("100000")],
    ["future_date", sale("1", addDays(TODAY, 1))],
    ["invalid", { ...sale("1"), quantity: "0" }],
    ["not_found", { ...sale("1"), holding_id: CASH }],
  ])("refuses with %s", (code, input) => {
    expect(writeMovement(state, input, { id: NEW_ID })).toEqual({
      state,
      result: { ok: false, code },
    });
  });

  it("re-admits an edit against the other movements", () => {
    const opening = state.movements.get(BTC)![0]!;
    const shrunk = {
      holding_id: BTC,
      kind: "opening_balance",
      date: opening.date,
      currency: "USD",
      quantity: "0.01",
      price: "30000",
    };
    expect(
      writeMovement(state, shrunk, { id: opening.id, replacing: opening.id })
        .result,
    ).toEqual({ ok: false, code: "oversold" });
    const edited = writeMovement(
      state,
      { ...shrunk, quantity: "0.2" },
      { id: opening.id, replacing: opening.id },
    );
    expect(edited.result).toEqual({ ok: true, id: opening.id });
    expect(edited.state.movements.get(BTC)).toHaveLength(
      state.movements.get(BTC)!.length,
    );
  });

  it("closes a holding sold to zero and keeps its sales", () => {
    const held = fixtures.holdings.find((row) => row.id === AAPL)!.holding;
    const soldOut = writeMovement(state, sale(held.amount), { id: NEW_ID });
    expect(
      holdingsView(soldOut.state).active.map((row) => row.id),
    ).not.toContain(AAPL);
    const sales = salesOf(soldOut.state, {
      year: TODAY.slice(0, 4),
      unit: "ars",
      filter: NO_FILTER,
      names: NAMES,
      limit: 100,
    });
    expect(sales.rows[0]!.movement.id).toBe(NEW_ID);
  });

  it("gives a movement on a weekend or today a cost in pesos", () => {
    // 2026-10-10 is a Saturday.
    for (const date of ["2026-10-10", TODAY]) {
      const written = writeMovement(state, sale("1", date), { id: NEW_ID });
      const page = movementsPage(
        written.state,
        { holdingId: AAPL },
        "ars",
        null,
      );
      if (!page.ok) throw new Error("page failed");
      const line = page.rows.find((row) => row.movement.id === NEW_ID)!;
      expect(line.cost).not.toBeNull();
    }
  });
});

describe("reads", () => {
  it("has a position for each holding with movements", () => {
    const positions = positionsOf(state, "usd_mep");
    expect(positions.get(AAPL)?.quantity).toBe(
      fixtures.holdings.find((row) => row.id === AAPL)!.holding.amount,
    );
    expect(positions.has(CASH)).toBe(false);
  });

  it("lists the sales of a year, closed holdings included, and cuts them at the limit", () => {
    const year = yearsOf(state)[0]!;
    const all = salesOf(state, {
      year,
      unit: "usd_mep",
      filter: NO_FILTER,
      names: NAMES,
      limit: 100,
    });
    const cut = salesOf(state, {
      year,
      unit: "usd_mep",
      filter: NO_FILTER,
      names: NAMES,
      limit: 1,
    });
    expect(cut.rows).toEqual(all.rows.slice(0, 1));
    expect(cut.truncated).toBe(all.rows.length > 1);
    expect(cut.totals).toEqual(all.totals);
    const allYears = yearsOf(state).flatMap(
      (each) =>
        salesOf(state, {
          year: each,
          unit: "usd_mep",
          filter: NO_FILTER,
          names: NAMES,
          limit: 100,
        }).rows,
    );
    expect(allYears.some((line) => line.movement.holding_id === AL30D)).toBe(
      true,
    );
  });

  it("filters the sales by the holdings' filters", () => {
    const year = yearsOf(state)[0]!;
    const crypto = salesOf(state, {
      year,
      unit: "usd_mep",
      filter: { ...NO_FILTER, search: "bitcoin" },
      names: NAMES,
      limit: 100,
    });
    expect(
      crypto.rows.every((line) => line.movement.holding_id === idOf("BTC")),
    ).toBe(true);
  });

  it("pages every scope's movements newest first, in pages that join up", () => {
    const portfolio = { portfolioId: fixtures.portfolios[0]!.id };
    const seen: string[] = [];
    let cursor = null;
    for (let page = 0; page < 10; page += 1) {
      const read = movementsPage(state, portfolio, "ars", cursor, 7);
      if (!read.ok) throw new Error("page failed");
      seen.push(...read.rows.map((row) => row.movement.id));
      cursor = read.next;
      if (!cursor) break;
    }
    const holdings = allRows(state)
      .filter((row) => row.portfolio.id === portfolio.portfolioId)
      .map((row) => row.id);
    const expected = [...state.movements.entries()]
      .filter(([id]) => holdings.includes(id))
      .flatMap(([, movements]) => movements)
      .sort((a, b) => compareMovements(b, a))
      .map((m) => m.id);
    expect(seen).toEqual(expected);
  });
});
