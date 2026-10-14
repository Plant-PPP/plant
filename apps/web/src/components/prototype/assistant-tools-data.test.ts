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
const mockReadCloses = jest.fn<Promise<ClosesRead>, unknown[]>(
  async () => read,
);
jest.mock("@/lib/summary/read", () => ({
  readCloses: (...args: unknown[]) => mockReadCloses(...args),
}));
const mockReadImports = jest.fn<Promise<unknown>, unknown[]>(async () => ({
  items: [
    {
      id: "i1",
      fileName: "Resumen IOL septiembre.pdf",
      accountId: "a1",
      status: "failed" as const,
      error: "No pudimos leer el archivo.",
      documentDate: null,
      documentTotals: [],
      rows: [],
      createdOn: "2026-10-10",
    },
  ],
  used: 3,
}));
jest.mock("@/lib/imports/read", () => ({
  readImports: (...args: unknown[]) => mockReadImports(...args),
}));
jest.mock("@/lib/holdings/read", () => ({
  readReferenceDollar: async () => "mep",
}));

import { incomeCalendar } from "@/lib/assistant/income";
import { assistantData, CHART_TOPICS } from "@/lib/assistant/tools-data";
import { pricedToday } from "@/lib/summary/compute";
import { summaryValuation } from "@/lib/summary/valuation";

// The session's client: every read goes through it, so RLS keeps it to the
// user's rows.
const SESSION = { session: "u1" } as never;

const data = () =>
  assistantData({
    client: SESSION,
    context: {
      userId: "u1",
      requestId: undefined,
      page: "/assistant",
      params: {},
    },
    unit: "usd_mep",
    today: TODAY,
  });

beforeEach(() => {
  mockReadCloses.mockClear();
  mockReadImports.mockClear();
});

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

it("values the assets the same in every tool", async () => {
  const tools = data();
  const summary = await tools.portfolioSummary();
  const split = await tools.allocation();
  if (!("assets" in summary) || !("total" in split)) throw new Error();
  expect(summary.assets).toBe(split.total);
});

it("gives the last 12 closes and this year's result", async () => {
  const history = await data().netWorthHistory();
  expect(history.months.length).toBeLessThanOrEqual(12);
  expect(history.thisYear?.year).toBe("2026");
  // A percent to one decimal, as every other tool's share.
  expect(history.thisYear?.share ?? "0").toMatch(/^-?\d+(\.\d)?$/);
  // Each month complete as the closes table marks it.
  const closes = closesOf(read.state, "usd_mep").slice(-12);
  expect(history.months.map((month) => month.complete)).toEqual(
    closes.map((month) => month.complete),
  );
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

it("lists what the user will collect, summed by month as the events add up", async () => {
  const income = await data().incomeEvents();
  const events = incomeCalendar(read.state, pricedToday(read.state), "usd_mep");
  expect(income.events.map((event) => event.date)).toEqual(
    events.map((event) => event.date),
  );
  const months = income.byMonth.reduce(
    (sum, month) => sum + Number(month.value),
    0,
  );
  const listed = income.events.reduce(
    (sum, event) => sum + Number(event.value ?? 0),
    0,
  );
  expect(months).toBeCloseTo(listed, 2);
});

it("gives the debts with their total, as the summary owes", async () => {
  const tools = data();
  const debts = await tools.liabilities();
  const summary = await tools.portfolioSummary();
  if (!("debts" in summary)) throw new Error();
  expect(debts.total).toBe(summary.debts);
  expect(debts.count).toBe(read.state.liabilities.length);
  expect(debts.debts[0]?.kind).toMatch(/^[A-ZÁÉÍÓÚ]/);
});

it("lists one instrument's movements newest first, or says it does not know it", async () => {
  const tools = data();
  const all = await tools.transactions();
  if (!("movements" in all)) throw new Error();
  const symbol = read.holdings.active.find(
    (row) => row.holding.asset_class === "instrument",
  )!.holding;
  if (symbol.asset_class !== "instrument") throw new Error();
  const one = await tools.transactions(symbol.instrument_symbol);
  if (!("movements" in one)) throw new Error();
  expect(one.total).toBeGreaterThan(0);
  expect(one.total).toBeLessThanOrEqual(all.total);
  const dates = one.movements.map((movement) => movement.date);
  expect(dates).toEqual([...dates].sort().reverse());
  expect(await tools.transactions("NOPE")).toMatchObject({
    error: "unknown_instrument",
  });
});

it("tells what the user holds of an instrument and where", async () => {
  const row = read.holdings.active.find(
    (each) => each.holding.asset_class === "instrument",
  )!;
  if (row.holding.asset_class !== "instrument") throw new Error();
  const info = await data().assetInfo(
    row.holding.instrument_symbol.toLowerCase(),
  );
  if (!("holdings" in info)) throw new Error();
  expect(info.symbol).toBe(row.holding.instrument_symbol);
  expect(info.holdings.length).toBeGreaterThan(0);
});

it("names a crypto loan's installment in what was borrowed", async () => {
  mockReadCloses.mockResolvedValueOnce({
    ...read,
    state: {
      ...read.state,
      liabilities: [
        {
          id: "loan",
          kind: "crypto_loan",
          label: "Préstamo BTC",
          lender: null,
          currency: null,
          uva: false,
          instrument_symbol: "BTC",
          balance: "0.5",
          installment: "0.01",
          annual_rate: null,
          installments_left: 50,
          next_due_on: null,
          matures_on: null,
        },
      ],
    },
  });
  const debts = await data().liabilities();
  expect(debts.debts[0]).toMatchObject({
    installment: "0.01",
    installmentCurrency: "BTC",
  });
});

it("quotes a bond per 100 nominal, as the pages show it", async () => {
  const held = read.holdings.active.find(
    (each) =>
      each.holding.asset_class === "instrument" &&
      read.state.instruments.find(
        (instrument) => instrument.symbol === each.holding.instrument_symbol,
      )?.type === "bond",
  );
  if (held?.holding.asset_class !== "instrument") throw new Error();
  const tools = data();
  const info = await tools.assetInfo(held.holding.instrument_symbol);
  if (!("priceBasis" in info)) throw new Error();
  expect(info.priceBasis).toBe("cada 100 VN");
  const { valuation } = summaryValuation(read, {
    unit: "usd_mep",
    portfolioId: null,
  });
  const perUnit = valuation.values[held.id]?.price;
  if (!perUnit || !info.price) throw new Error();
  expect(Number(info.price)).toBeCloseTo(100 * Number(perUnit), 6);
  const moves = await tools.transactions(held.holding.instrument_symbol);
  if (!("movements" in moves)) throw new Error();
  expect(
    moves.movements.every((each) => each.priceBasis === "cada 100 VN"),
  ).toBe(true);
});

it("gives the latest imports and the month's count", async () => {
  const status = await data().importStatus();
  expect(status).toMatchObject({
    usedThisMonth: 3,
    monthlyLimit: 20,
    imports: [{ status: "Con error", uploadedOn: "2026-10-10" }],
  });
});

it("reads everything through the session's client", async () => {
  const tools = data();
  await tools.liabilities();
  await tools.importStatus();
  expect(mockReadCloses).toHaveBeenCalledWith(
    SESSION,
    expect.anything(),
    expect.anything(),
  );
  expect(mockReadImports).toHaveBeenCalledWith(SESSION);
});

it("draws net worth as the history gives it, and caps every chart", async () => {
  const tools = data();
  const history = await tools.netWorthHistory();
  const drawn = await tools.chart("net_worth");
  if (!("chart" in drawn)) throw new Error();
  expect(drawn.chart.kind).toBe("line");
  expect(drawn.chart.points.map((point) => point.value)).toEqual(
    history.months.slice(0, 12).map((month) => month.endValue),
  );
  for (const kind of CHART_TOPICS) {
    const each = await tools.chart(kind);
    if (!("chart" in each)) throw new Error(kind);
    expect(each.chart.points.length).toBeLessThanOrEqual(12);
    expect(each.chart.points.every((point) => point.label.length <= 30)).toBe(
      true,
    );
  }
  expect(await tools.chart("holdings", "nope")).toMatchObject({
    error: "unknown_portfolio",
  });
});

it("prices a hypothetical from today's net worth, labelled as one", async () => {
  const tools = data();
  const summary = await tools.portfolioSummary();
  const scenario = await tools.scenario({ dollar: "mep", dollarChange: "10" });
  if (!("today" in scenario) || !("netWorth" in summary)) throw new Error();
  expect(scenario.today.netWorth).toBe(summary.netWorth);
  expect(scenario).toMatchObject({
    hypothetical: true,
    label: "Escenario hipotético",
    assumptions: ["el dólar MEP sube 10 %"],
    unit: "usd_mep",
  });
  expect(scenario.chart.title).toMatch(/hipotético/);
  expect(
    await tools.scenario({ instrument: "Nada", priceChange: "10" }),
  ).toMatchObject({ error: "unknown_instrument" });
  expect(await tools.scenario({})).toEqual({ error: "no_change" });
  expect(await tools.scenario({ dollar: "mep" })).toEqual({
    error: "no_change",
  });
  expect(
    await tools.scenario({ instrument: "TSLA", priceChange: "10" }),
  ).toMatchObject({ error: "unknown_instrument" });
  const ccl = await tools.scenario({ dollar: "ccl", dollarChange: "10.05" });
  if (!("changesNothing" in ccl)) throw new Error();
  expect(ccl.assumptions).toEqual([]);
  expect(ccl.changesNothing).toEqual(["el dólar CCL sube 10,05 %"]);
  const apple = await tools.scenario({
    instrument: "aapl",
    priceChange: "-20",
  });
  if (!("change" in apple)) throw new Error();
  expect(Number(apple.change)).toBeLessThan(0);
});

it("summarizes the last closed month with a waterfall that adds up", async () => {
  const tools = data();
  const month = await tools.monthSummary({});
  if (!("breakdown" in month)) throw new Error();
  expect(month).toMatchObject({
    period: "septiembre de 2026",
    months: 1,
    inProgress: false,
    sources: ["Cierres", "Movimientos", "Cotizaciones"],
  });
  const { contributed, prices, dollar, yields } = month.breakdown;
  expect(
    [contributed, prices, dollar, yields].reduce(
      (sum, each) => sum + Number(each),
      0,
    ),
  ).toBeCloseTo(Number(month.change), 6);
  expect(month.chart.template).toBe("waterfall");
  const range = await tools.monthSummary({ from: "2026-09", to: "2026-07" });
  if (!("months" in range)) throw new Error();
  expect(range.period).toBe("julio de 2026 a septiembre de 2026");
  expect(await tools.monthSummary({ from: "1999-01" })).toMatchObject({
    error: "unknown_month",
  });
});
