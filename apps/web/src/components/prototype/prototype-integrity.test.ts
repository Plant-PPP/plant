import {
  admitMovements,
  compareMovements,
  positionOf,
  replay,
} from "@plant/core";
import { compareDecimals } from "@plant/shared";

import { buildFixtures } from "@/lib/prototype/fixtures";

import {
  archivePortfolio,
  createPortfolio,
  deleteAccount,
  deletePortfolio,
} from "./prototype-accounts-store";
import {
  createHolding,
  deleteHolding,
  deleteOperation,
  initialState,
  updateHolding,
  type PrototypeState,
  type Write,
  writeOperation,
} from "./prototype-store";

// The rules a database's foreign keys and checks would keep, read off the
// prototype's state: every movement belongs to a holding there is, every
// holding to an account and a portfolio there are, an instrument holding's
// quantity is what its movements leave, and an operation's parts agree.
function integrity(state: PrototypeState): string[] {
  const problems: string[] = [];
  const holdings = new Map(
    state.holdings.map((each) => [each.holding.id, each]),
  );
  const accounts = new Set(
    [...state.accounts, ...state.archivedAccounts].map(({ id }) => id),
  );
  const portfolios = new Set(
    [...state.portfolios, ...state.archivedPortfolios].map(({ id }) => id),
  );
  const archived = new Set([
    ...state.archivedAccounts.map(({ id }) => id),
    ...state.archivedPortfolios.map(({ id }) => id),
  ]);
  const instruments = new Set<string>();
  for (const stored of state.holdings) {
    const id = stored.holding.id;
    if (
      !stored.closed &&
      (archived.has(stored.accountId) || archived.has(stored.portfolioId))
    ) {
      problems.push(`${id}: open in an archived account or portfolio`);
    }
    if (stored.holding.asset_class === "instrument") {
      const key = `${stored.accountId}/${stored.portfolioId}/${stored.holding.instrument_symbol}`;
      if (instruments.has(key)) problems.push(`${key}: held twice`);
      instruments.add(key);
    }
    if (!accounts.has(stored.accountId)) problems.push(`${id}: no account`);
    if (!portfolios.has(stored.portfolioId)) {
      problems.push(`${id}: no portfolio`);
    }
    if (stored.holding.asset_class !== "instrument") continue;
    const own = state.movements.get(id) ?? [];
    if (own.length === 0) {
      problems.push(`${id}: an instrument holding with no movement`);
      continue;
    }
    const sorted = [...own].sort(compareMovements);
    if (sorted.some((each, index) => each !== own[index])) {
      problems.push(`${id}: movements out of order`);
    }
    if (!admitMovements({ prior: null, after: own }).ok) {
      problems.push(`${id}: movements that do not make a history`);
    }
    const { quantity } = positionOf(replay(own, "ars", state.referenceDollar));
    const held = stored.closed ? "0" : stored.holding.amount;
    if (compareDecimals(quantity, held) !== 0) {
      problems.push(`${id}: holds ${held}, its movements leave ${quantity}`);
    }
  }
  const parts = new Map<
    string,
    { kind: string; date: string; entryOrder: number }[]
  >();
  for (const [holdingId, own] of state.movements) {
    if (!holdings.has(holdingId)) {
      problems.push(`${holdingId}: movements of no holding`);
    }
    for (const movement of own) {
      if (movement.holding_id !== holdingId) {
        problems.push(`${movement.id}: filed under another holding`);
      }
      parts.set(movement.operation_id, [
        ...(parts.get(movement.operation_id) ?? []),
        {
          kind: movement.kind,
          date: movement.date,
          entryOrder: movement.entry_order,
        },
      ]);
      // Also true of a missing one.
      if (!(movement.entry_order < state.nextEntryOrder)) {
        problems.push(`${movement.id}: an entry order not below the next`);
      }
    }
  }
  for (const [operationId, each] of parts) {
    if (each.some((part) => part.kind !== each[0]!.kind)) {
      problems.push(`${operationId}: parts of different kinds`);
    }
    if (each.some((part) => part.date !== each[0]!.date)) {
      problems.push(`${operationId}: parts on different dates`);
    }
    if (each.some((part) => part.entryOrder !== each[0]!.entryOrder)) {
      problems.push(`${operationId}: parts in different entry orders`);
    }
  }
  const byEntryOrder = new Map<number, string>();
  for (const [operationId, [first]] of parts) {
    const other = byEntryOrder.get(first!.entryOrder);
    if (other !== undefined) {
      problems.push(`${operationId}: shares its entry order with ${other}`);
    }
    byEntryOrder.set(first!.entryOrder, operationId);
  }
  return problems;
}

const TODAY = "2026-10-12";
const fixtures = buildFixtures(TODAY);
const start = initialState(fixtures, TODAY);
const idOf = (symbol: string, portfolio?: string) =>
  start.holdings.find(
    (each) =>
      each.holding.asset_class === "instrument" &&
      each.holding.instrument_symbol === symbol &&
      (portfolio === undefined || each.portfolioId === portfolio),
  )!.holding.id;
const account = (institution: string) =>
  start.accounts.find((each) => each.institution === institution)!.id;
const [PRINCIPAL, LARGO] = start.portfolios.map(({ id }) => id) as [
  string,
  string,
];
const TEMP = "e9000000-0000-4000-8000-999999999999";
let ids = 0;
const newId = () =>
  `e9000000-0000-4000-8000-${String((ids += 1)).padStart(12, "0")}`;
const write = (operationId = newId()) => ({ operationId, newId });

const trade = (
  kind: "purchase" | "sale",
  symbol: string,
  institution: string,
  date: string,
  parts: { portfolio_id: string; quantity: string }[],
) => ({
  kind,
  source_connection_id: account(institution),
  instrument_symbol: symbol,
  date,
  currency: fixtures.instruments.find((each) => each.symbol === symbol)!
    .currency,
  price: "100",
  charges: [{ kind: "commission", label: null, amount: "3" }],
  parts,
});

it("starts consistent", () => {
  expect(integrity(start)).toEqual([]);
});

it("stays consistent through every kind of write", () => {
  let state = start;
  const apply = <R extends { ok: boolean }>(
    step: string,
    change: (state: PrototypeState) => Write<R>,
  ) => {
    const { state: next, result } = change(state);
    expect({ step, ok: result.ok, problems: integrity(next) }).toEqual({
      step,
      ok: true,
      problems: [],
    });
    state = next;
  };

  const split = newId();
  apply("a purchase split across two portfolios", (s) =>
    writeOperation(
      s,
      trade("purchase", "BTC", "Binance", "2026-05-04", [
        { portfolio_id: PRINCIPAL, quantity: "0.5" },
        { portfolio_id: LARGO, quantity: "0.25" },
      ]),
      write(split),
    ),
  );
  apply("the split moved whole to one portfolio", (s) =>
    writeOperation(
      s,
      trade("purchase", "BTC", "Binance", "2026-05-04", [
        { portfolio_id: LARGO, quantity: "0.75" },
      ]),
      { ...write(split), replacing: true },
    ),
  );
  const sale = newId();
  apply("a sale", (s) =>
    writeOperation(
      s,
      trade("sale", "AAPL", "IOL", "2026-09-20", [
        { portfolio_id: PRINCIPAL, quantity: "10" },
      ]),
      write(sale),
    ),
  );
  apply("the sale edited", (s) =>
    writeOperation(
      s,
      trade("sale", "AAPL", "IOL", "2026-09-21", [
        { portfolio_id: PRINCIPAL, quantity: "12" },
      ]),
      { ...write(sale), replacing: true },
    ),
  );
  apply("the sale deleted", (s) => deleteOperation(s, sale));
  apply("a sell-out", (s) =>
    writeOperation(
      s,
      trade("sale", "AAPL", "IOL", "2026-09-22", [
        {
          portfolio_id: PRINCIPAL,
          quantity: s.holdings.find(
            (each) => each.holding.id === idOf("AAPL", PRINCIPAL),
          )!.holding.amount,
        },
      ]),
      write(),
    ),
  );
  apply("a buy-back the same day", (s) =>
    writeOperation(
      s,
      trade("purchase", "AAPL", "IOL", "2026-09-22", [
        { portfolio_id: PRINCIPAL, quantity: "5" },
      ]),
      write(),
    ),
  );
  const moved = newId();
  apply("a purchase", (s) =>
    writeOperation(
      s,
      trade("purchase", "AAPL", "IOL", "2026-09-23", [
        { portfolio_id: PRINCIPAL, quantity: "2" },
      ]),
      write(moved),
    ),
  );
  apply("a sale entered after it", (s) =>
    writeOperation(
      s,
      trade("sale", "AAPL", "IOL", "2026-09-24", [
        { portfolio_id: PRINCIPAL, quantity: "6" },
      ]),
      write(),
    ),
  );
  apply("the purchase moved to the sale's day, keeping its place", (s) =>
    writeOperation(
      s,
      trade("purchase", "AAPL", "IOL", "2026-09-24", [
        { portfolio_id: PRINCIPAL, quantity: "2" },
      ]),
      { ...write(moved), replacing: true },
    ),
  );
  apply("the split deleted", (s) => deleteOperation(s, split));
  apply("an instrument holding created with a quantity", (s) =>
    createHolding(
      s,
      {
        source_connection_id: account("IOL"),
        portfolio_id: LARGO,
        asset_class: "instrument",
        instrument_symbol: "AAPL",
        amount: "7",
        currency: null,
        annual_rate: null,
        started_on: null,
        matures_on: null,
        valued_on: null,
        label: null,
      },
      newId(),
    ),
  );
  apply("a holding deleted with its movements", (s) =>
    deleteHolding(s, idOf("SPY")),
  );
  apply("a sold-out instrument bought back through a new holding", (s) =>
    createHolding(
      s,
      {
        source_connection_id: account("Cocos"),
        portfolio_id: start.holdings.find(
          (each) => each.holding.id === idOf("TSLA"),
        )!.portfolioId,
        asset_class: "instrument",
        instrument_symbol: "TSLA",
        amount: "3",
        currency: null,
        annual_rate: null,
        started_on: null,
        matures_on: null,
        valued_on: null,
        label: null,
      },
      newId(),
    ),
  );

  expect(
    createHolding(
      state,
      {
        source_connection_id: account("IOL"),
        portfolio_id: PRINCIPAL,
        asset_class: "instrument",
        instrument_symbol: "AAPL",
        amount: "1",
        currency: null,
        annual_rate: null,
        started_on: null,
        matures_on: null,
        valued_on: null,
        label: null,
      },
      newId(),
    ).result,
  ).toEqual({ ok: false, code: "duplicate" });

  expect(deleteAccount(state, account("IOL")).result).toEqual({
    ok: false,
    code: "source_connection_has_holdings",
  });
  expect(deletePortfolio(state, LARGO).result.ok).toBe(false);
  expect(integrity(state)).toEqual([]);
});

it("refuses a write that would break a holding's history, changing nothing", () => {
  const firstTesla = start.movements.get(idOf("TSLA"))![0]!;
  const refused = deleteOperation(start, firstTesla.operation_id);
  expect(refused.result.ok).toBe(false);
  expect(refused.state).toBe(start);
});

it("never reopens a holding inside an archived portfolio", () => {
  // A purchase and a sale of all of it in a new portfolio, which is then
  // archived with nothing open.
  let state = createPortfolio(start, { name: "Temporal" }, TEMP).state;
  const purchase = newId();
  state = writeOperation(
    state,
    trade("purchase", "ETH", "Binance", "2026-03-02", [
      { portfolio_id: TEMP, quantity: "0.2" },
    ]),
    write(purchase),
  ).state;
  const sale = newId();
  state = writeOperation(
    state,
    trade("sale", "ETH", "Binance", "2026-04-02", [
      { portfolio_id: TEMP, quantity: "0.2" },
    ]),
    write(sale),
  ).state;
  state = archivePortfolio(state, TEMP).state;
  expect(integrity(state)).toEqual([]);
  const refused = deleteOperation(state, sale);
  expect(refused.result).toEqual({ ok: false, code: "not_found" });
  expect(refused.state).toBe(state);
});

const instrumentInput = (
  institution: string,
  portfolio: string,
  symbol: string,
  amount: string,
) => ({
  source_connection_id: account(institution),
  portfolio_id: portfolio,
  asset_class: "instrument" as const,
  instrument_symbol: symbol,
  amount,
  currency: null,
  annual_rate: null,
  started_on: null,
  matures_on: null,
  valued_on: null,
  label: null,
});

it("never opens units at a made-up cost", () => {
  // MSFT has no price, from the feeds or the user.
  const refused = createHolding(
    start,
    instrumentInput("IOL", LARGO, "MSFT", "7"),
    newId(),
  );
  expect(refused.result).toEqual({ ok: false, code: "invalid" });
  expect(refused.state).toBe(start);
});

it("never moves a holding onto its instrument's holding in a portfolio", () => {
  const split = newId();
  const state = writeOperation(
    start,
    trade("purchase", "BTC", "Binance", "2026-05-04", [
      { portfolio_id: PRINCIPAL, quantity: "0.5" },
      { portfolio_id: LARGO, quantity: "0.25" },
    ]),
    write(split),
  ).state;
  const largo = state.holdings.find(
    (each) =>
      each.portfolioId === LARGO &&
      each.holding.asset_class === "instrument" &&
      each.holding.instrument_symbol === "BTC",
  )!;
  const moved = updateHolding(state, largo.holding.id, {
    asset_class: "instrument",
    amount: largo.holding.amount,
    currency: null,
    annual_rate: null,
    started_on: null,
    matures_on: null,
    valued_on: null,
    label: null,
    portfolio_id: PRINCIPAL,
  });
  expect(moved.result).toEqual({ ok: false, code: "duplicate" });
  expect(integrity(moved.state)).toEqual([]);
});

it("reloads the other parts' holdings when one is deleted", () => {
  const split = newId();
  const state = writeOperation(
    start,
    trade("purchase", "BTC", "Binance", "2026-05-04", [
      { portfolio_id: PRINCIPAL, quantity: "0.5" },
      { portfolio_id: LARGO, quantity: "0.25" },
    ]),
    write(split),
  ).state;
  const holdingOf = (portfolio: string) =>
    state.holdings.find(
      (each) =>
        each.portfolioId === portfolio &&
        each.holding.asset_class === "instrument" &&
        each.holding.instrument_symbol === "BTC",
    )!.holding.id;
  const principal = holdingOf(PRINCIPAL);
  const deleted = deleteHolding(state, holdingOf(LARGO)).state;
  expect(deleted.revisions.get(principal)).toBe(
    state.revisions.get(principal)! + 1,
  );
  expect(integrity(deleted)).toEqual([]);
});

it("keeps an edited operation's account and instrument", () => {
  const sale = newId();
  const sold = writeOperation(
    start,
    trade("sale", "AAPL", "IOL", "2026-09-20", [
      { portfolio_id: PRINCIPAL, quantity: "1" },
    ]),
    write(sale),
  ).state;
  for (const [symbol, institution] of [
    ["MELI", "IOL"],
    ["AAPL", "Cocos"],
  ] as const) {
    const moved = writeOperation(
      sold,
      trade("sale", symbol, institution, "2026-09-20", [
        { portfolio_id: PRINCIPAL, quantity: "1" },
      ]),
      { ...write(sale), replacing: true },
    );
    expect(moved.result).toEqual({ ok: false, code: "invalid" });
    expect(moved.state).toBe(sold);
  }
});
