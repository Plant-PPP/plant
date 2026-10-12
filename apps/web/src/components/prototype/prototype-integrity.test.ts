import {
  admitMovements,
  compareMovements,
  positionOf,
  replayHoldings,
} from "@plant/core";
import { compareDecimals } from "@plant/shared";

import { buildFixtures } from "@/lib/prototype/fixtures";

import {
  archiveAccount,
  archivePortfolio,
  createAccount,
  createPortfolio,
  deleteAccount,
  deletePortfolio,
} from "./prototype-accounts-store";
import {
  createHolding,
  deleteHolding,
  deleteOperation,
  groupKey,
  initialState,
  type StoredHolding,
  updateHolding,
  type PrototypeState,
  type Write,
  writeOperation,
} from "./prototype-store";

// The rules a database's foreign keys and checks would keep, read off the
// prototype's state: every movement belongs to a holding there is, every
// holding to an account and a portfolio there are, an instrument holding's
// quantity is what its movements leave, and an operation's parts agree. A
// transfer moves one quantity out of one portfolio's holding of an instrument
// and into another portfolio's holding of it in the same account.
function integrity(state: PrototypeState): string[] {
  const problems: string[] = [];
  const steps = replayHoldings(
    [...state.movements.values()].flat(),
    "ars",
    state.referenceDollar,
  );
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
    const quantity = positionOf(steps.get(id) ?? []).quantity;
    const held = stored.closed ? "0" : stored.holding.amount;
    if (compareDecimals(quantity, held) !== 0) {
      problems.push(`${id}: holds ${held}, its movements leave ${quantity}`);
    }
  }
  const parts = new Map<
    string,
    {
      kind: string;
      date: string;
      entryOrder: number;
      direction: string | null;
      quantity: string | null;
      holding: StoredHolding | undefined;
    }[]
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
          direction: "direction" in movement ? movement.direction : null,
          quantity: "quantity" in movement ? movement.quantity : null,
          holding: holdings.get(holdingId),
        },
      ]);
      // Written as !(<) so a missing entry order fails too.
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
    if (each[0]!.kind === "yield" && each.length !== 1) {
      problems.push(`${operationId}: a yield in more than one holding`);
    }
    if (each[0]!.kind !== "transfer") continue;
    const [out, arrived] = [...each].sort((a, b) =>
      a.direction === "out" ? -1 : b.direction === "out" ? 1 : 0,
    );
    if (
      each.length !== 2 ||
      out!.direction !== "out" ||
      arrived!.direction !== "in" ||
      compareDecimals(out!.quantity!, arrived!.quantity!) !== 0
    ) {
      problems.push(`${operationId}: a transfer without one side each way`);
    } else if (
      !out!.holding ||
      !arrived!.holding ||
      groupKey(out!.holding) !== groupKey(arrived!.holding) ||
      out!.holding.portfolioId === arrived!.holding.portfolioId
    ) {
      problems.push(
        `${operationId}: a transfer outside one account's instrument`,
      );
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
  const btcFrom = start.holdings.find(
    (each) => each.holding.id === idOf("BTC"),
  )!.portfolioId;
  const btcTo = btcFrom === PRINCIPAL ? LARGO : PRINCIPAL;
  const transfer = (quantity: string, to = btcTo, date = "2026-09-25") => ({
    kind: "transfer",
    source_connection_id: account("Binance"),
    instrument_symbol: "BTC",
    date,
    currency: "USD",
    reference: null,
    note: null,
    parts: [
      { portfolio_id: btcFrom, direction: "out", quantity },
      { portfolio_id: to, direction: "in", quantity, price: null },
    ],
  });
  const moving = newId();
  apply("a transfer between portfolios", (s) =>
    writeOperation(s, transfer("0.1"), write(moving)),
  );
  apply("the transfer edited", (s) =>
    writeOperation(s, transfer("0.2", btcTo, "2026-09-26"), {
      ...write(moving),
      replacing: true,
    }),
  );
  apply("the transfer moved to a new portfolio", (s) => {
    const other = createPortfolio(s, { name: "Otra" }, TEMP).state;
    return writeOperation(other, transfer("0.2", TEMP), {
      ...write(moving),
      replacing: true,
    });
  });
  apply("the transfer deleted", (s) => deleteOperation(s, moving));
  apply("a transfer that stays", (s) =>
    writeOperation(s, transfer("0.05"), write()),
  );
  const staking = (
    part: { direction: "in" | "out"; quantity: string } | { balance: string },
    date = "2026-09-27",
  ) => ({
    kind: "yield",
    source_connection_id: account("Binance"),
    instrument_symbol: "BTC",
    date,
    currency: "USD",
    price: "60000",
    reference: null,
    note: null,
    parts: [{ portfolio_id: btcFrom, ...part }],
  });
  const earned = newId();
  apply("a yield", (s) =>
    writeOperation(
      s,
      staking({ direction: "in", quantity: "0.001" }),
      write(earned),
    ),
  );
  apply("the yield edited to a balance", (s) => {
    const held = s.holdings.find((each) => each.holding.id === idOf("BTC"))!
      .holding.amount;
    return writeOperation(s, staking({ balance: held }, "2026-09-28"), {
      ...write(earned),
      replacing: true,
    });
  });
  // Held today is what the 28th ended with, the yield's own unit included.
  expect(
    state.movements
      .get(idOf("BTC"))!
      .find((each) => each.operation_id === earned),
  ).toMatchObject({ kind: "yield", direction: "in", quantity: "0.001" });
  apply("a loss", (s) =>
    writeOperation(
      s,
      staking({ direction: "out", quantity: "0.002" }),
      write(),
    ),
  );
  apply("the yield deleted", (s) => deleteOperation(s, earned));
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
  expect(refused.result).toEqual({ ok: false, code: "portfolio_archived" });
  expect(refused.state).toBe(state);
});

it("never reopens a holding inside an archived account, nor by an edit", () => {
  // A new account that bought and then sold all it held, archived with
  // nothing open; and a portfolio left the same way.
  const LEMON = "e9000000-0000-4000-8000-888888888888";
  let state = createAccount(
    start,
    {
      institution: "Lemon",
      holder: "self",
      includeInTaxReport: true,
      defaultPortfolioId: PRINCIPAL,
    },
    LEMON,
  ).state;
  state = createPortfolio(state, { name: "Temporal" }, TEMP).state;
  const held = (portfolio: string) => ({
    ...trade("purchase", "ETH", "Binance", "2026-03-02", [
      { portfolio_id: portfolio, quantity: "0.2" },
    ]),
  });
  const inLemon = (input: ReturnType<typeof held>) => ({
    ...input,
    source_connection_id: LEMON,
  });
  state = writeOperation(state, inLemon(held(PRINCIPAL)), write()).state;
  const lemonSale = newId();
  state = writeOperation(
    state,
    inLemon(
      trade("sale", "ETH", "Binance", "2026-04-02", [
        { portfolio_id: PRINCIPAL, quantity: "0.2" },
      ]),
    ),
    write(lemonSale),
  ).state;
  state = writeOperation(state, held(TEMP), write()).state;
  state = writeOperation(state, held(PRINCIPAL), write()).state;
  const tempSale = newId();
  state = writeOperation(
    state,
    trade("sale", "ETH", "Binance", "2026-04-02", [
      { portfolio_id: TEMP, quantity: "0.2" },
    ]),
    write(tempSale),
  ).state;
  const archived = archiveAccount(state, LEMON);
  expect(archived.result.ok).toBe(true);
  state = archivePortfolio(archived.state, TEMP).state;
  expect(integrity(state)).toEqual([]);

  const deleted = deleteOperation(state, lemonSale);
  expect(deleted.result).toEqual({
    ok: false,
    code: "source_connection_archived",
  });
  expect(deleted.state).toBe(state);

  // The sale moved to Principal would leave Temporal's units open.
  const moved = writeOperation(
    state,
    trade("sale", "ETH", "Binance", "2026-04-02", [
      { portfolio_id: PRINCIPAL, quantity: "0.2" },
    ]),
    { ...write(tempSale), replacing: true },
  );
  expect(moved.result).toEqual({ ok: false, code: "portfolio_archived" });
  expect(moved.state).toBe(state);
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
