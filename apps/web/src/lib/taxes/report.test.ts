import type { Holding } from "@plant/core";

import { assetKey, type AssetKey } from "@/lib/holdings/assets-rows";
import { type Ledger, MANUAL, writeOperation } from "@/lib/ledger/ledger";
import {
  ACCOUNT,
  emptyLedger,
  PORTFOLIO,
} from "@/lib/ledger/ledger-fixture.test-support";
import type { ClosesState } from "@/lib/summary/compute";

import { taxTables } from "./export";
import {
  defaultTaxYear,
  leftOutOf,
  taxDate,
  taxReport,
  taxYearOf,
  taxYears,
} from "./report";

const OTHER_ACCOUNT = "a6000000-0000-4000-8000-0000000000a6";

const trade = (
  kind: "purchase" | "sale",
  symbol: string,
  date: string,
  quantity: string,
  price: string,
) => ({
  kind,
  source_connection_id: ACCOUNT,
  instrument_symbol: symbol,
  date,
  currency: "ARS",
  price,
  charges: [],
  reference: null,
  note: null,
  parts: [{ portfolio_id: PORTFOLIO, quantity }],
});

const CASH: Holding = {
  id: "c0000000-0000-4000-8000-0000000000c0",
  portfolio_id: PORTFOLIO,
  asset_class: "cash",
  currency: "USD",
  amount: "100",
  instrument_symbol: null,
  annual_rate: null,
  started_on: null,
  matures_on: null,
  valued_on: null,
  label: null,
};

const MOVEMENT_DAYS = [
  "2025-03-03",
  "2025-04-01",
  "2025-06-02",
  "2025-07-01",
  "2025-12-30",
];

// AAPL bought twice and sold in part, with a dividend, AL30 held, and
// dollars in cash, in 2025; seen on 2026-10-12.
function ledger(): ClosesState {
  const base = emptyLedger();
  let state: Ledger = {
    ...base,
    instruments: [
      ...base.instruments,
      { symbol: "AL30", name: "Bonar 2030", currency: "ARS", type: "bond" },
    ],
    quotes: {
      fxRates: [
        ...base.quotes.fxRates,
        ...MOVEMENT_DAYS.flatMap((date) => [
          { kind: "mep" as const, rate_date: date, sell: "1100" },
          { kind: "ccl" as const, rate_date: date, sell: "1150" },
          { kind: "official" as const, rate_date: date, sell: "1050" },
        ]),
      ],
      prices: [
        {
          symbol: "AAPL",
          price_date: "2025-12-30",
          price: "4000",
          currency: "ARS",
        },
        {
          symbol: "AL30",
          price_date: "2025-12-31",
          price: "60",
          currency: "ARS",
        },
      ],
    },
  };
  const ops = [
    trade("purchase", "AAPL", "2025-03-03", "10", "1000"),
    trade("purchase", "AAPL", "2025-04-01", "10", "2000"),
    trade("sale", "AAPL", "2025-06-02", "15", "3000"),
    trade("purchase", "AL30", "2025-03-03", "100", "50"),
    {
      kind: "dividend",
      source_connection_id: ACCOUNT,
      instrument_symbol: "AAPL",
      date: "2025-07-01",
      currency: "ARS",
      charges: [],
      reference: null,
      note: null,
      parts: [{ portfolio_id: PORTFOLIO, amount: "500" }],
    },
  ];
  ops.forEach((op, index) => {
    const written = writeOperation(state, op, {
      operationId: `op-${index}`,
      newId: () => crypto.randomUUID(),
    });
    expect(written.result).toMatchObject({ ok: true });
    state = written.state;
  });
  return {
    ...state,
    holdings: [
      ...state.holdings,
      {
        holding: CASH,
        accountId: ACCOUNT,
        portfolioId: PORTFOLIO,
        closed: false,
        origin: MANUAL,
      },
    ],
    liabilities: [],
    liabilityEvents: new Map(),
    recalculated: new Map(),
  };
}

const OFFICIAL_BUY = { buy: "1000", date: "2025-12-30" };
const NONE = new Set<AssetKey>();

it("values what was held at the year's end in pesos, bonds exempt", () => {
  const state = ledger();
  const report = taxReport(state, {
    year: "2025",
    officialBuy: OFFICIAL_BUY,
    leftOut: leftOutOf(state, NONE),
    isPlazoFijo: () => true,
  });
  expect(report).toMatchObject({ date: "2025-12-31", provisional: false });
  const byName = Object.fromEntries(
    report.wealth.lines.map((line) => [line.name, line]),
  );
  expect(byName["AAPL · Apple"]).toMatchObject({
    amount: "20000",
    ars: "20000",
    exempt: false,
  });
  expect(byName["AL30 · Bonar 2030"]).toMatchObject({
    ars: "6000",
    exempt: true,
  });
  // Dollars at the official buying rate.
  expect(byName["Efectivo USD"]).toMatchObject({
    currency: "USD",
    amount: "100",
    ars: "100000",
  });
  expect(report.wealth).toMatchObject({
    taxable: "120000",
    exempt: "6000",
    complete: true,
  });
});

it("adds up the year's sales, oldest units first, and its income", () => {
  const state = ledger();
  const { gains } = taxReport(state, {
    year: "2025",
    officialBuy: OFFICIAL_BUY,
    leftOut: leftOutOf(state, NONE),
    isPlazoFijo: () => true,
  });
  // 15 sold at 3.000: 10 bought at 1.000 and 5 at 2.000.
  expect(gains.groups).toEqual([
    { kind: "sale_cedear", count: 1, amount: "25000" },
    { kind: "dividend", count: 1, amount: "500" },
  ]);
  expect(gains).toMatchObject({ total: "25500", complete: true });
});

it("leaves out an asset the user left out, and every one of an account", () => {
  const state = ledger();
  const aapl = state.holdings.find(
    (each) =>
      each.holding.asset_class === "instrument" &&
      each.holding.instrument_symbol === "AAPL",
  )!;
  const report = taxReport(state, {
    year: "2025",
    officialBuy: OFFICIAL_BUY,
    leftOut: leftOutOf(state, new Set([assetKey(aapl.holding)])),
    isPlazoFijo: () => true,
  });
  expect(report.wealth.lines.map((line) => line.name)).not.toContain(
    "AAPL · Apple",
  );
  expect(report.gains.groups).toEqual([]);
  expect(report.leftOut).toBe(1);

  const outOfReport = {
    ...state,
    accounts: state.accounts.map((each) => ({
      ...each,
      includeInTaxReport: false,
    })),
  };
  const none = taxReport(outOfReport, {
    year: "2025",
    officialBuy: OFFICIAL_BUY,
    leftOut: leftOutOf(outOfReport, NONE),
    isPlazoFijo: () => true,
  });
  expect(none.wealth.lines).toEqual([]);
  expect(none.leftOut).toBe(3);
  expect(
    leftOutOf(
      outOfReport,
      NONE,
    )({
      ...aapl,
      id: aapl.holding.id,
      account: { id: OTHER_ACCOUNT, institution: "Otra" },
      portfolio: { id: PORTFOLIO, name: "Principal" },
      instrumentType: "cedear",
    }),
  ).toBe(false);
});

it("marks dollars unvalued without a buying rate", () => {
  const state = ledger();
  const { wealth } = taxReport(state, {
    year: "2025",
    officialBuy: null,
    leftOut: leftOutOf(state, NONE),
    isPlazoFijo: () => true,
  });
  expect(wealth.complete).toBe(false);
  expect(wealth.taxable).toBe("20000");
});

it("offers every year from the first movement's and opens on the last one that ended", () => {
  const state = ledger();
  const years = taxYears(state);
  expect(years).toEqual(["2026", "2025"]);
  expect(defaultTaxYear(years, state.today)).toBe("2025");
  expect(defaultTaxYear(["2026"], state.today)).toBe("2026");
  expect(taxYearOf("2026", years, state.today)).toBe("2026");
  expect(taxYearOf("1999", years, state.today)).toBe("2025");
  expect(taxDate("2026", state.today)).toBe(state.today);
});

it("exports both sections as tables", () => {
  const state = ledger();
  const [wealth, gains] = taxTables(
    taxReport(state, {
      year: "2025",
      officialBuy: OFFICIAL_BUY,
      leftOut: leftOutOf(state, NONE),
      isPlazoFijo: () => true,
    }),
  );
  expect(wealth!.name).toBe("bienes-personales-2025");
  expect(wealth!.rows).toContainEqual([
    "AL30 · Bonar 2030",
    "Bono",
    "ARS",
    "6000",
    "6000",
    "Sí",
  ]);
  expect(gains!.rows).toEqual([
    ["Venta de CEDEARs", "1", "25000"],
    ["Dividendos", "1", "500"],
  ]);
});

it("counts a yield that takes units out as the ledger books it", () => {
  const state = ledger();
  // One AAPL unit, held at a cost of 2.000, lost on a day it was worth 3.000.
  const written = writeOperation(
    state,
    {
      kind: "yield",
      source_connection_id: ACCOUNT,
      instrument_symbol: "AAPL",
      date: "2025-07-01",
      currency: "ARS",
      price: "3000",
      reference: null,
      note: null,
      parts: [{ portfolio_id: PORTFOLIO, direction: "out", quantity: "1" }],
    },
    { operationId: "lost", newId: () => crypto.randomUUID() },
  );
  expect(written.result).toMatchObject({ ok: true });
  const after = written.state;
  const { gains } = taxReport(after, {
    year: "2025",
    officialBuy: OFFICIAL_BUY,
    leftOut: leftOutOf(after, NONE),
    isPlazoFijo: () => true,
  });
  expect(gains.groups).toContainEqual({
    kind: "yield",
    count: 1,
    amount: "-2000",
  });
});

it("counts no placement left out that started after the year ended", () => {
  const state = ledger();
  const placement: Holding = {
    ...CASH,
    id: "f0000000-0000-4000-8000-0000000000f0",
    asset_class: "fixed_term",
    currency: "ARS",
    amount: "1000",
    annual_rate: "0.3",
    started_on: "2026-01-10",
    matures_on: "2026-02-10",
  } as Holding;
  const withPlacement: ClosesState = {
    ...state,
    holdings: [
      ...state.holdings,
      {
        holding: placement,
        accountId: ACCOUNT,
        portfolioId: PORTFOLIO,
        closed: false,
        origin: MANUAL,
      },
    ],
  };
  const report = taxReport(withPlacement, {
    year: "2025",
    officialBuy: OFFICIAL_BUY,
    leftOut: leftOutOf(withPlacement, new Set([assetKey(placement)])),
    isPlazoFijo: () => true,
  });
  expect(report.leftOut).toBe(0);
});
