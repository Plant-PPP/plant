import { snapshotOn } from "@plant/core";

import { holdingsView, initialState } from "./prototype-store";
import { buildFixtures } from "@/lib/prototype/fixtures";
import { closesOf } from "@/lib/summary/compute";
import type { ClosesRead } from "@/lib/summary/read";

const TODAY = "2026-10-12";
const state = initialState(buildFixtures(TODAY), TODAY);
const read: ClosesRead = {
  state: { ...state, recalculated: new Map() },
  holdings: holdingsView(state),
  ledgerTruncated: false,
  debtsTruncated: false,
};

jest.mock("server-only", () => ({}), { virtual: true });
const mockReadCloses = jest.fn(async () => read);
jest.mock("@/lib/summary/read", () => ({
  readCloses: () => mockReadCloses(),
}));
jest.mock("@/lib/holdings/read", () => ({
  readReferenceDollar: async () => "mep",
}));

import { assistantData } from "@/lib/assistant/tools-data";

const data = () =>
  assistantData({
    client: {} as never,
    context: {
      userId: "u1",
      requestId: undefined,
      page: "/assistant",
      params: {},
    },
    unit: "usd_mep",
    today: TODAY,
  });

beforeEach(() => mockReadCloses.mockClear());

it("gives the net worth Resumen shows, with assets and debts adding up to it", async () => {
  const summary = await data().portfolioSummary();
  const last = closesOf(read.state, "usd_mep").at(-1)!;
  expect(summary).toMatchObject({
    netWorth: last.figures.endValue,
    unit: "usd_mep",
    asOf: TODAY,
    sources: ["Tus tenencias", "Deudas", "Cotizaciones"],
  });
  if (!("assets" in summary) || summary.netWorth === null) throw new Error();
  expect(Number(summary.assets) - Number(summary.debts)).toBeCloseTo(
    Number(summary.netWorth),
    2,
  );
  expect(summary.rate?.label).toBe("MEP");
});

it("reads once a turn however many tools run", async () => {
  const tools = data();
  await Promise.all([
    tools.portfolioSummary(),
    tools.listHoldings(),
    tools.allocation(),
    tools.netWorthHistory(),
  ]);
  expect(mockReadCloses).toHaveBeenCalledTimes(1);
});

it("answers a portfolio's assets only, and names the user's portfolios when one is unknown", async () => {
  const portfolio = read.state.portfolios[0]!;
  const one = await data().portfolioSummary(portfolio.name.toUpperCase());
  expect(one).toMatchObject({ netWorth: null, portfolio: portfolio.name });
  const unknown = await data().portfolioSummary("Ninguna");
  expect(unknown).toEqual({
    error: "unknown_portfolio",
    portfolios: read.state.portfolios.map((each) => each.name),
  });
});

it("lists the largest holdings first, saying how many there are", async () => {
  const list = await data().listHoldings();
  if (!("holdings" in list)) throw new Error();
  expect(list.total).toBe(read.holdings.active.length);
  expect(list.shown).toBe(Math.min(30, list.total));
  const values = list.holdings.map((each) => Number(each.value ?? 0));
  expect(values).toEqual([...values].sort((a, b) => b - a));
});

it("splits the assets by kind, currency and account", async () => {
  const split = await data().allocation();
  if (!("byKind" in split)) throw new Error();
  expect(split.byKind.length).toBeGreaterThan(0);
  expect(split.byCurrency.length).toBeGreaterThan(0);
  expect(split.byAccount.length).toBeGreaterThan(0);
});

it("gives the last 12 closes and this year's result", async () => {
  const history = await data().netWorthHistory();
  expect(history.months.length).toBeLessThanOrEqual(12);
  expect(history.thisYear?.year).toBe("2026");
});

it("converts between pesos and dollars at today's rate", async () => {
  const snapshot = snapshotOn(read.state.quotes, TODAY, {
    fxKinds: ["mep"],
    symbols: [],
  }).snapshot;
  const sell = Number(snapshot.fx.mep!.sell);
  const converted = await data().convertCurrency({
    amount: "1000",
    from: "usd_mep",
    to: "ars",
  });
  if (!("converted" in converted)) throw new Error();
  expect(Number(converted.converted)).toBeCloseTo(1000 * sell, 0);
});
