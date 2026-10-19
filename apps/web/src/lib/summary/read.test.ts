import type { Liability, LiabilityEvent } from "@plant/core";

import type { HoldingRow } from "@/lib/holdings/read";
import {
  emptyLedger,
  PORTFOLIO,
} from "@/lib/ledger/ledger-fixture.test-support";

const readHoldings = jest.fn();
const readUnlistedCash = jest.fn();
const readLiabilities = jest.fn();
const readLiabilityEvents = jest.fn();
const readLedger = jest.fn();

jest.mock("server-only", () => ({}), { virtual: true });
jest.mock("@/lib/holdings/read", () => ({
  readHoldings: (...args: unknown[]) => readHoldings(...args),
  readUnlistedCash: (...args: unknown[]) => readUnlistedCash(...args),
}));
jest.mock("@/lib/ledger/read", () => ({
  ...jest.requireActual("@/lib/ledger/read"),
  readLedger: () => readLedger(),
}));
jest.mock("@/lib/debts/read", () => ({
  readLiabilities: (...args: unknown[]) => readLiabilities(...args),
  readLiabilityEvents: (...args: unknown[]) => readLiabilityEvents(...args),
}));
jest.mock("@/lib/cash/read", () => ({
  readCashMovements: async () => ({ byHolding: new Map(), cut: false }),
}));
jest.mock("@/lib/quotes/quote-reader", () => ({
  createQuoteReader: () => ({
    read: async () => ({ fxRates: [], prices: [] }),
  }),
}));

import { readCloses } from "./read";

const cash = (id: string, amount: string): HoldingRow => ({
  id,
  holding: {
    id,
    portfolio_id: PORTFOLIO,
    asset_class: "cash",
    currency: "ARS",
    amount,
    instrument_symbol: null,
    annual_rate: null,
    started_on: null,
    matures_on: null,
    valued_on: null,
    label: null,
  },
  account: { id: "a5000000-0000-4000-8000-0000000000a5", institution: "IOL" },
  portfolio: { id: PORTFOLIO, name: "Principal" },
  instrumentType: null,
});

const OPEN = "c1000000-0000-4000-8000-0000000000c1";
const EMPTIED = "c2000000-0000-4000-8000-0000000000c2";
const debt = { id: "d1" } as Liability;
const take = (holding: string | null, takes = true) =>
  ({
    kind: "payment",
    date: "2026-09-01",
    cash_holding_id: holding,
    takes_cash: takes,
  }) as LiabilityEvent;

const context = {
  userId: "u1",
  requestId: "r1",
  page: "/" as const,
  params: {},
};
const read = () =>
  readCloses({} as never, context, {
    today: "2026-10-12",
    referenceDollar: "mep",
  });

beforeEach(() => {
  readLedger.mockResolvedValue({
    ledger: emptyLedger(),
    truncated: false,
    symbolOf: new Map(),
  });
  readHoldings.mockResolvedValue({
    active: [cash(OPEN, "100")],
    activeTruncated: false,
  });
  readUnlistedCash.mockResolvedValue([cash(EMPTIED, "50")]);
  readLiabilities.mockResolvedValue({
    active: [debt],
    activeTruncated: false,
  });
  readLiabilityEvents.mockResolvedValue({
    byLiability: new Map([
      ["d1", [take(OPEN), take(EMPTIED), take(EMPTIED), take(null)]],
      ["gone", [take("c3000000-0000-4000-8000-0000000000c3")]],
    ]),
    cut: false,
  });
});

it("reads the archived holdings only the debts' payments took cash from", async () => {
  const { state, archivedCashCount } = await read();
  expect(readUnlistedCash).toHaveBeenCalledWith({}, context, [EMPTIED]);
  expect(readHoldings).toHaveBeenCalledWith({}, context, { archived: false });
  expect(archivedCashCount).toBe(1);
  expect(
    state.holdings.map(({ holding, closed }) => [holding.id, closed]),
  ).toEqual([
    [OPEN, false],
    [EMPTIED, true],
  ]);
  expect(state.partial).toBe(false);
});

it("reads no archived holding when no payment took cash", async () => {
  readLiabilityEvents.mockResolvedValue({
    byLiability: new Map([["d1", [take(EMPTIED, false)]]]),
    cut: false,
  });
  readUnlistedCash.mockClear();
  expect((await read()).archivedCashCount).toBe(0);
  expect(readUnlistedCash).not.toHaveBeenCalled();
});

it.each([
  ["ledger", { ledger: true }],
  ["events", { events: true }],
  ["debts", { debts: true }],
  ["holdings", { holdings: true }],
])("is partial when the %s read was cut", async (_, cut) => {
  readLiabilityEvents.mockResolvedValue({
    byLiability: new Map(),
    cut: "events" in cut,
  });
  readLiabilities.mockResolvedValue({
    active: [debt],
    activeTruncated: "debts" in cut,
  });
  readHoldings.mockResolvedValue({
    active: [],
    activeTruncated: "holdings" in cut,
  });
  readLedger.mockResolvedValue({
    ledger: emptyLedger(),
    truncated: "ledger" in cut,
    symbolOf: new Map(),
  });
  expect((await read()).state.partial).toBe(true);
});
