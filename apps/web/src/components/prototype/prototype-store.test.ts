import { compareMovements } from "@plant/core";
import { addDays, exactOf, stored, times } from "@plant/shared";

import { buildFixtures } from "@/lib/prototype/fixtures";

import {
  allRows,
  createHolding,
  deleteHolding,
  deleteOperation,
  deletePrice,
  holdingsView,
  initialState,
  instrumentHoldings,
  movementsPage,
  positionsOf,
  salesOf,
  updateHolding,
  operationOf,
  writeOperation,
  yearsOf,
} from "./prototype-store";

const TODAY = "2026-10-12";
const fixtures = buildFixtures(TODAY);
const state = initialState(fixtures, TODAY);
const NO_FILTER = { portfolioId: null, holdingClass: null, search: "" };
const NAMES = new Map(fixtures.instruments.map((i) => [i.symbol, i.name]));

const idOf = (symbol: string) =>
  fixtures.holdings.find(
    (row) =>
      row.holding.asset_class === "instrument" &&
      row.holding.instrument_symbol === symbol,
  )!.id;
const AAPL = idOf("AAPL");
const TSLA = idOf("TSLA");
const CASH = fixtures.holdings.find(
  (row) => row.holding.asset_class === "cash",
)!.id;
const NEW_ID = "e1000000-0000-4000-8000-000000000001";

const IOL = fixtures.accounts.find((row) => row.institution === "IOL")!.id;
const COCOS = fixtures.accounts.find((row) => row.institution === "Cocos")!.id;
const BINANCE = fixtures.accounts.find(
  (row) => row.institution === "Binance",
)!.id;
const [PRINCIPAL, LARGO, CORTO] = fixtures.portfolios.map((row) => row.id) as [
  string,
  string,
  string,
];
let ids = 0;
const options = (operationId = NEW_ID) => ({
  operationId,
  newId: () =>
    `e2000000-0000-4000-8000-${String((ids += 1)).padStart(12, "0")}`,
});

// A sale of Apple, held in IOL's Principal.
const sale = (quantity: string, date = TODAY) => ({
  kind: "sale",
  source_connection_id: IOL,
  instrument_symbol: "AAPL",
  date,
  currency: "ARS",
  price: "18000",
  parts: [{ portfolio_id: PRINCIPAL, quantity }],
});

describe("holdings", () => {
  it("lists open holdings and leaves the closed one out", () => {
    const shown = holdingsView(state).active.map((row) => row.id);
    expect(shown).not.toContain(TSLA);
    expect(shown).toContain(AAPL);
    expect(allRows(state).map((row) => row.id)).toContain(TSLA);
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

describe("operations", () => {
  it("records a sale, revises the holding and sets its amount", () => {
    const before = fixtures.holdings.find((row) => row.id === AAPL)!;
    const written = writeOperation(state, sale("1"), options());
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
    ["invalid", sale("0")],
    ["not_found", { ...sale("1"), instrument_symbol: "XYZ" }],
    // Nothing of Apple sits in Largo plazo to sell.
    [
      "not_found",
      { ...sale("1"), parts: [{ portfolio_id: LARGO, quantity: "1" }] },
    ],
  ])("refuses with %s and changes nothing", (code, input) => {
    expect(writeOperation(state, input, options())).toEqual({
      state,
      result: { ok: false, code },
    });
  });

  it("splits one purchase across portfolios, creating the holding it needs, and its charges by quantity", () => {
    const purchase = {
      kind: "purchase",
      source_connection_id: BINANCE,
      instrument_symbol: "BTC",
      date: TODAY,
      currency: "USD",
      price: "60000",
      parts: [
        { portfolio_id: LARGO, quantity: "0.75" },
        { portfolio_id: CORTO, quantity: "0.25" },
      ],
      charges: [{ kind: "commission", label: null, amount: "8" }],
      reference: "BIN-1",
    };
    const written = writeOperation(state, purchase, options());
    expect(written.result).toEqual({ ok: true, id: NEW_ID });
    const parts = operationOf(written.state, NEW_ID)!.parts;
    expect(parts.map((part) => part.portfolioId).sort()).toEqual(
      [LARGO, CORTO].sort(),
    );
    expect(
      parts.map((part) => [part.portfolioId, part.movement.charges[0]?.amount]),
    ).toEqual(
      expect.arrayContaining([
        [LARGO, "6"],
        [CORTO, "2"],
      ]),
    );
    const btcInCorto = holdingsView(written.state).active.find(
      (row) =>
        row.portfolio.id === CORTO &&
        row.holding.asset_class === "instrument" &&
        row.holding.instrument_symbol === "BTC",
    );
    expect(btcInCorto?.holding.amount).toBe("0.25");
  });

  it("edits a whole operation, re-admitting its holdings", () => {
    // Tesla's first purchase, which its later sale of every unit needs.
    const first = state.movements.get(TSLA)![0]!;
    const shrunk = {
      kind: "purchase",
      source_connection_id: COCOS,
      instrument_symbol: "TSLA",
      date: first.date,
      currency: "ARS",
      price: "20000",
      parts: [{ portfolio_id: CORTO, quantity: "1" }],
    };
    const edit = { ...options(first.operation_id), replacing: true };
    expect(writeOperation(state, shrunk, edit).result).toEqual({
      ok: false,
      code: "oversold",
    });
    const edited = writeOperation(
      state,
      { ...shrunk, parts: [{ portfolio_id: CORTO, quantity: "30" }] },
      edit,
    );
    expect(edited.result).toEqual({ ok: true, id: first.operation_id });
    expect(edited.state.movements.get(TSLA)).toHaveLength(
      state.movements.get(TSLA)!.length,
    );
  });

  it("closes a holding sold to zero and keeps its sales", () => {
    const held = fixtures.holdings.find((row) => row.id === AAPL)!.holding;
    const soldOut = writeOperation(state, sale(held.amount), options());
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
    expect(sales.rows[0]!.operationId).toBe(NEW_ID);
  });

  it("gives a movement on a weekend or today a cost in pesos", () => {
    // 2026-10-10 is a Saturday.
    for (const date of ["2026-10-10", TODAY]) {
      const written = writeOperation(state, sale("1", date), options());
      const page = movementsPage(
        written.state,
        { holdingId: AAPL },
        "ars",
        null,
      );
      if (!page.ok) throw new Error("page failed");
      const line = page.rows.find(
        (row) => row.movement.operation_id === NEW_ID,
      )!;
      expect(line.amount).not.toBeNull();
    }
  });
});

it("lists a split sale once, with its parts' totals", () => {
  const split = {
    kind: "sale",
    source_connection_id: BINANCE,
    instrument_symbol: "ETH",
    date: TODAY,
    currency: "USD",
    price: "2500",
    parts: [
      { portfolio_id: PRINCIPAL, quantity: "0.1" },
      { portfolio_id: LARGO, quantity: "0.1" },
    ],
    charges: [{ kind: "commission", label: null, amount: "2" }],
  };
  const written = writeOperation(state, split, options());
  expect(written.result).toEqual({ ok: true, id: NEW_ID });
  const sales = salesOf(written.state, {
    year: TODAY.slice(0, 4),
    unit: "usd_mep",
    filter: NO_FILTER,
    names: NAMES,
    limit: 100,
  });
  const line = sales.rows.find((row) => row.operationId === NEW_ID)!;
  expect(line.movements).toHaveLength(2);
  expect(line.sale?.gross).toBe("500");
  expect(line.sale?.charges).toBe("2");
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
    expect(allYears.some((line) => line.row.id === TSLA)).toBe(true);
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
    expect(crypto.rows.every((line) => line.row.id === idOf("BTC"))).toBe(true);
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

describe("instrument history", () => {
  const snapshot = {
    date: TODAY,
    fx: { mep: { sell: "1500", date: TODAY } },
    prices: { ETH: { price: "2500", currency: "USD" as const, date: TODAY } },
  };

  it("gathers an instrument's holdings across portfolios, with their flows", () => {
    const { holdings, flows } = instrumentHoldings(
      state,
      "ETH",
      "usd_mep",
      snapshot,
    );
    expect(new Set(holdings.map((each) => each.row.portfolio.id))).toEqual(
      new Set([PRINCIPAL, LARGO]),
    );
    expect(holdings.every((each) => each.value !== null)).toBe(true);
    expect(flows).toHaveLength(
      holdings.reduce(
        (count, each) => count + state.movements.get(each.row.id)!.length,
        0,
      ),
    );
  });

  it("lists an instrument's movements from every holding of it", () => {
    const page = movementsPage(state, { symbol: "ETH" }, "usd_mep", null);
    expect(
      page.ok && page.rows.map((line) => line.movement.holding_id),
    ).toEqual(
      expect.arrayContaining(
        instrumentHoldings(state, "ETH", "usd_mep", snapshot).holdings.map(
          (each) => each.row.id,
        ),
      ),
    );
  });
});

describe("deletes", () => {
  it("deletes a holding with its movements", () => {
    const { state: next, result } = deleteHolding(state, AAPL);
    expect(result).toEqual({ ok: true, id: AAPL });
    expect(allRows(next).some((row) => row.id === AAPL)).toBe(false);
    expect(next.movements.has(AAPL)).toBe(false);
  });

  it("deletes every part of a split operation", () => {
    const split = state.movements
      .get(idOf("ETH"))!
      .find((each) => each.reference === "BIN-77310")!;
    const { state: next, result } = deleteOperation(state, split.operation_id);
    expect(result).toEqual({ ok: true, id: split.operation_id });
    const left = [...next.movements.values()]
      .flat()
      .filter((each) => each.operation_id === split.operation_id);
    expect(left).toEqual([]);
    // The Largo plazo holding had only its part, so it goes too.
    expect(
      allRows(next).filter(
        (row) =>
          row.holding.asset_class === "instrument" &&
          row.holding.instrument_symbol === "ETH",
      ),
    ).toHaveLength(1);
  });

  it("refuses a delete that leaves a later sale selling more than held", () => {
    const first = state.movements.get(TSLA)![0]!;
    expect(deleteOperation(state, first.operation_id).result).toEqual({
      ok: false,
      code: "oversold",
    });
  });

  it("deletes a manual price on its date", () => {
    const [price] = state.manualPrices;
    const { state: next } = deletePrice(
      state,
      price!.symbol,
      price!.price_date,
    );
    expect(next.manualPrices).toHaveLength(state.manualPrices.length - 1);
  });
});

it("shows a sale's amount as what it brought before charges", () => {
  const sale = [...state.movements.values()]
    .flat()
    .find(
      (each): each is Extract<typeof each, { kind: "sale" }> =>
        each.kind === "sale" && each.currency === "ARS",
    )!;
  const page = movementsPage(
    state,
    { holdingId: sale.holding_id },
    "ars",
    null,
  );
  if (!page.ok) throw new Error("page failed");
  const line = page.rows.find((row) => row.movement.id === sale.id)!;
  expect(line.amount).toBe(
    stored(times(exactOf(sale.quantity), exactOf(sale.price))),
  );
});

describe("entry order", () => {
  // Bitcoin in Binance's Corto plazo, which holds none yet.
  const btc = (
    kind: "opening_balance" | "purchase" | "sale",
    quantity: string,
    date: string,
    price = "100",
  ) => ({
    kind,
    source_connection_id: BINANCE,
    instrument_symbol: "BTC",
    date,
    currency: "USD",
    price,
    parts: [{ portfolio_id: CORTO, quantity }],
  });
  const [D1, D2, D3] = [3, 2, 1].map((days) => addDays(TODAY, -days)) as [
    string,
    string,
    string,
  ];
  const corto = (s: typeof state) =>
    s.holdings.find(
      (each) =>
        each.portfolioId === CORTO &&
        each.holding.asset_class === "instrument" &&
        each.holding.instrument_symbol === "BTC",
    )!.holding.id;
  const run = (
    steps: [ReturnType<typeof btc>, string, boolean?][],
    from = state,
  ) =>
    steps.reduce((s, [input, operationId, replacing = false]) => {
      const written = writeOperation(s, input, {
        ...options(operationId),
        replacing,
      });
      expect(written.result).toEqual({ ok: true, id: operationId });
      return written.state;
    }, from);
  const positionIn = (s: typeof state) =>
    positionsOf(s, "usd_mep").get(corto(s))!;
  const costOf = (s: typeof state) => positionIn(s).money!.cost;
  const entryOf = (s: typeof state, operationId: string) =>
    operationOf(s, operationId)!.parts[0]!.movement.entry_order;
  const [A, B, S, P, Q] = [1, 2, 3, 4, 5].map(
    (n) => `e3000000-0000-4000-8000-00000000000${n}`,
  ) as [string, string, string, string, string];

  it("opens a new cost for a buy-back on the day of a sell-out", () => {
    const written = run([
      [btc("purchase", "1", D1, "100"), A],
      [btc("sale", "1", D2, "150"), S],
      [btc("purchase", "1", D2, "200"), B],
    ]);
    expect(costOf(written)).toBe("200");
  });

  it("sells what was bought earlier the same day", () => {
    const written = run([
      [btc("purchase", "1", D2), A],
      [btc("sale", "1", D2), S],
    ]);
    expect(positionIn(written).quantity).toBe("0");
  });

  it("keeps an edit's place on its date", () => {
    const written = run([
      [btc("purchase", "1", D1, "100"), A],
      [btc("sale", "1", D2, "150"), S],
      [btc("purchase", "1", D2, "200"), B],
      [btc("sale", "1", D2, "160"), S, true],
    ]);
    expect(costOf(written)).toBe("200");
    expect(written.nextEntryOrder).toBe(state.nextEntryOrder + 3);
  });

  it("puts a sale moved to a later day after what was entered there", () => {
    const before = run([
      [btc("purchase", "1", D1), A],
      [btc("sale", "1", D2), S],
      [btc("purchase", "1", D3), B],
    ]);
    const moved = run([[btc("sale", "2", D3), S, true]], before);
    expect(entryOf(moved, S)).toBe(before.nextEntryOrder);
    expect(moved.nextEntryOrder).toBe(before.nextEntryOrder + 1);
    const after = run([[btc("purchase", "1", D3), P]], moved);
    expect(entryOf(after, P)).toBeGreaterThan(entryOf(after, S));
  });

  it("keeps the place of a purchase moved to a later sale's day when last would leave the sale nothing before it", () => {
    const before = run([
      [btc("purchase", "1", D2), P],
      [btc("sale", "1", D3), S],
    ]);
    const moved = run([[btc("purchase", "1", D3), P, true]], before);
    expect(entryOf(moved, P)).toBe(entryOf(before, P));
    expect(moved.nextEntryOrder).toBe(before.nextEntryOrder);
  });

  it("keeps the place of a purchase moved to a later sale's day when last would oversell", () => {
    const before = run([
      [btc("purchase", "1", D1), A],
      [btc("purchase", "1", D2), P],
      [btc("sale", "2", D3), S],
    ]);
    const moved = run([[btc("purchase", "1", D3), P, true]], before);
    expect(entryOf(moved, P)).toBe(entryOf(before, P));
  });

  it("makes a purchase moved onto a sell-out's day a buy-back", () => {
    const before = run([
      [btc("purchase", "1", D1, "100"), A],
      [btc("purchase", "1", D2, "200"), P],
      [btc("sale", "1", D3, "150"), S],
    ]);
    const moved = run([[btc("purchase", "1", D3, "200"), P, true]], before);
    expect(costOf(moved)).toBe("200");
  });

  it("refuses an edit on its date that would sell what was bought after it", () => {
    const before = run([
      [btc("purchase", "1", D1), A],
      [btc("sale", "1", D2), S],
      [btc("purchase", "1", D2), B],
    ]);
    const refused = writeOperation(before, btc("sale", "2", D2), {
      ...options(S),
      replacing: true,
    });
    expect(refused.result).toEqual({ ok: false, code: "oversold" });
    expect(refused.state).toBe(before);
    // Entered again, it goes after the purchase.
    const again = run(
      [[btc("sale", "2", D2), Q]],
      deleteOperation(before, S).state,
    );
    expect(positionIn(again).quantity).toBe("0");
  });

  it("refuses a date move no place admits, changing nothing", () => {
    const before = run([
      [btc("purchase", "1", D1), A],
      [btc("purchase", "1", D2), P],
      [btc("sale", "2", D2), S],
    ]);
    const refused = writeOperation(before, btc("purchase", "1", D3), {
      ...options(P),
      replacing: true,
    });
    expect(refused.result).toEqual({ ok: false, code: "oversold" });
    expect(refused.state).toBe(before);
  });

  it("refuses moving a purchase onto the day of a sale entered before it", () => {
    const before = run([
      [btc("purchase", "1", D1), A],
      [btc("sale", "1", D3), S],
      [btc("purchase", "1", D2), P],
    ]);
    const deleted = deleteOperation(before, A).state;
    const refused = writeOperation(deleted, btc("purchase", "1", D3), {
      ...options(P),
      replacing: true,
    });
    expect(refused.result).toEqual({ ok: false, code: "opening_balance" });
  });

  it("puts a purchase moved to an earlier day last there", () => {
    const before = run([
      [btc("purchase", "1", D1), A],
      [btc("sale", "1", D1), S],
      [btc("purchase", "1", D3), P],
    ]);
    const moved = run([[btc("purchase", "1", D1, "200"), P, true]], before);
    expect(entryOf(moved, P)).toBe(before.nextEntryOrder);
  });

  it("refuses an operation that names its own entry order", () => {
    expect(
      writeOperation(
        state,
        { ...btc("purchase", "1", D1), entry_order: 0 },
        options(A),
      ).result,
    ).toEqual({ ok: false, code: "invalid" });
  });

  it("keeps an opening balance's entry order when its date moves", () => {
    const before = run([[btc("opening_balance", "1", D1), A]]);
    const moved = run([[btc("opening_balance", "1", D2), A, true]], before);
    expect(entryOf(moved, A)).toBe(entryOf(before, A));
    expect(moved.nextEntryOrder).toBe(before.nextEntryOrder);
  });

  it("puts an opening balance turned into a purchase last on its day", () => {
    const before = run([
      [btc("opening_balance", "1", D2), A],
      [btc("purchase", "1", D2), B],
    ]);
    const relabelled = run([[btc("purchase", "1", D2), A, true]], before);
    expect(entryOf(relabelled, A)).toBe(before.nextEntryOrder);
    expect(entryOf(relabelled, A)).toBeGreaterThan(entryOf(relabelled, B));
  });

  it("refuses an edit of an operation there is not, changing nothing", () => {
    const refused = writeOperation(state, btc("purchase", "1", D1), {
      ...options(A),
      replacing: true,
    });
    expect(refused.result).toEqual({ ok: false, code: "not_found" });
    expect(refused.state).toBe(state);
  });

  it("keeps the place of an opening balance turned into a purchase when last would leave a sale first", () => {
    const before = run([
      [btc("opening_balance", "1", D2), A],
      [btc("sale", "1", D2), S],
    ]);
    const relabelled = run([[btc("purchase", "1", D2), A, true]], before);
    expect(entryOf(relabelled, A)).toBe(entryOf(before, A));
  });

  it("refuses deleting the purchase that a sale entered before a same-day purchase needs", () => {
    const before = run([
      [btc("purchase", "1", D1), A],
      [btc("sale", "1", D3), S],
      [btc("purchase", "1", D3), P],
    ]);
    expect(deleteOperation(before, A).result).toEqual({
      ok: false,
      code: "opening_balance",
    });
  });

  it("keeps the place of a purchase turned into a sale on its date", () => {
    const before = run([
      [btc("purchase", "2", D1), A],
      [btc("purchase", "1", D2), P],
      [btc("sale", "1", D2), S],
    ]);
    const relabelled = run([[btc("sale", "1", D2), P, true]], before);
    expect(entryOf(relabelled, P)).toBe(entryOf(before, P));
    expect(relabelled.nextEntryOrder).toBe(before.nextEntryOrder);
  });

  it("keeps every part's number when a split edit falls back", () => {
    const split = (date: string) => ({
      ...btc("purchase", "1", date),
      parts: [
        { portfolio_id: CORTO, quantity: "1" },
        { portfolio_id: PRINCIPAL, quantity: "1" },
      ],
    });
    const before = run([
      [split(D2), P],
      [
        {
          ...btc("sale", "1", D3),
          parts: [{ portfolio_id: PRINCIPAL, quantity: "1" }],
        },
        S,
      ],
    ]);
    const moved = run([[split(D3), P, true]], before);
    expect(
      operationOf(moved, P)!.parts.map((part) => part.movement.entry_order),
    ).toEqual([entryOf(before, P), entryOf(before, P)]);
    expect(positionIn(moved).quantity).toBe("1");
  });

  it("keeps the number of a purchase turned into an opening balance on another date", () => {
    const before = run([
      [btc("purchase", "1", D2), A],
      [btc("purchase", "1", D3), B],
    ]);
    const moved = run([[btc("opening_balance", "1", D1), A, true]], before);
    expect(entryOf(moved, A)).toBe(entryOf(before, A));
    expect(moved.nextEntryOrder).toBe(before.nextEntryOrder);
  });

  it("changes nothing when an edit is refused after creating a holding", () => {
    const before = run([
      [btc("purchase", "1", D1), A],
      [btc("purchase", "1", D2), P],
      [btc("sale", "2", D2), S],
    ]);
    const refused = writeOperation(
      before,
      {
        ...btc("purchase", "1", D3),
        parts: [
          { portfolio_id: PRINCIPAL, quantity: "1" },
          { portfolio_id: CORTO, quantity: "1" },
        ],
      },
      { ...options(P), replacing: true },
    );
    expect(refused.result).toEqual({ ok: false, code: "oversold" });
    expect(refused.state).toBe(before);
  });

  it("changes nothing when an edit is refused", () => {
    const before = run([
      [btc("purchase", "1", D2), P],
      [btc("sale", "1", D3), S],
    ]);
    const refused = writeOperation(
      before,
      {
        ...btc("sale", "1", D1),
        parts: [
          { portfolio_id: CORTO, quantity: "1" },
          { portfolio_id: LARGO, quantity: "1" },
        ],
      },
      { ...options(S), replacing: true },
    );
    expect(refused.result.ok).toBe(false);
    expect(refused.state).toBe(before);
  });
});
