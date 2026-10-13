import type { HoldingClass } from "./classes";
import {
  type Holding,
  holdingSchema,
  type QuoteSnapshot,
  valueHoldings,
} from "@plant/core";

import {
  holdingInSentence,
  holdingName,
  instrumentNames,
} from "./holding-name";
import { holdingsValuation } from "./valuation-view";

// Test data mirroring core's valuation fixture.
const SNAPSHOT: QuoteSnapshot = {
  date: "2026-10-12",
  fx: {
    mep: { sell: "1200", date: "2026-10-09" },
    ccl: { sell: "1250", date: "2026-10-09" },
    official: { sell: "1000", date: "2026-10-09" },
  },
  prices: {
    BTC: { price: "65000", currency: "USD", date: "2026-10-12" },
  },
};

const empty = {
  instrument_symbol: null,
  currency: null,
  annual_rate: null,
  started_on: null,
  matures_on: null,
  valued_on: null,
  label: null,
};
const holding = (fields: Record<string, unknown>): Holding =>
  holdingSchema.parse({ ...empty, ...fields });

const HOLDINGS = [
  holding({
    id: "btc",
    portfolio_id: "p1",
    asset_class: "instrument",
    instrument_symbol: "BTC",
    amount: "0.5",
  }),
  holding({
    id: "cash",
    portfolio_id: "p1",
    asset_class: "cash",
    currency: "ARS",
    amount: "120000.005",
  }),
  holding({
    id: "home",
    portfolio_id: "p2",
    asset_class: "real_estate",
    currency: "USD",
    amount: "50000",
    valued_on: "2026-10-01",
    label: "Depto",
  }),
];

const ACCOUNT_OF: Record<string, string> = {
  btc: "a1",
  cash: "a1",
  home: "a2",
};
const rows = (holdings: readonly Holding[]) =>
  holdings.map((holding) => ({
    holding,
    account: { id: ACCOUNT_OF[holding.id]! },
    instrumentType:
      holding.asset_class === "instrument" ? ("crypto" as const) : null,
  }));

const base = {
  holdings: rows(HOLDINGS),
  truncated: false,
  snapshot: SNAPSHOT,
  unit: "ars" as const,
  referenceDollar: "mep" as const,
};

// btc, cash and home over their ARS total; one holding per class.
const SHARES = ["39.3", "0.1", "60.5"];

describe("holdingsValuation", () => {
  it("takes every value and sum from core", () => {
    const view = holdingsValuation(base);
    const options = {
      denominator: "ars" as const,
      referenceDollar: "mep" as const,
    };
    const all = valueHoldings(HOLDINGS, SNAPSHOT, options);
    expect(view.kinds.total.value).toBe(all.total);
    expect(Object.values(view.values)).toEqual(
      all.items.map((item) => expect.objectContaining(item)),
    );
    expect(view.portfolios).toEqual({
      p1: expect.objectContaining({
        value: valueHoldings(HOLDINGS, SNAPSHOT, {
          ...options,
          portfolioId: "p1",
        }).total,
        complete: true,
        count: 2,
      }),
      p2: expect.objectContaining({
        value: valueHoldings(HOLDINGS, SNAPSHOT, {
          ...options,
          portfolioId: "p2",
        }).total,
        complete: true,
        count: 1,
      }),
    });
    expect(view.kinds.total).toMatchObject({ complete: true, missing: 0 });
  });

  it("is incomplete when a quote is missing", () => {
    const view = holdingsValuation({
      ...base,
      snapshot: { ...SNAPSHOT, prices: {} },
    });
    expect(view.kinds.total).toMatchObject({ complete: false, missing: 1 });
    expect(view.values.btc?.value).toBeNull();
    expect(view.portfolios.p1?.complete).toBe(false);
  });

  it("marks every sum incomplete when the list was cut", () => {
    const view = holdingsValuation({ ...base, truncated: true });
    expect(
      [
        view.kinds.total,
        view.kinds.cash,
        view.portfolios.p1,
        view.accounts.a1?.total,
        view.classes.cash,
      ].map((sum) => sum?.complete),
    ).toEqual([false, false, false, false, false]);
    expect(view.kinds.total.missing).toBe(0);
  });

  it("values only the holdings it is given", () => {
    const view = holdingsValuation({
      ...base,
      holdings: rows(HOLDINGS.filter((h) => h.portfolio_id === "p2")),
    });
    expect(Object.keys(view.values)).toEqual(["home"]);
    expect(Object.keys(view.portfolios)).toEqual(["p2"]);
    expect(view.kinds.total.value).toBe(view.portfolios.p2?.value);
    expect(view.portfolios.p2?.share).toBe("100");
  });

  it("prices one unit of an instrument or currency in the page's unit", () => {
    const view = holdingsValuation({ ...base, unit: "usd_mep" });
    expect(view.values.btc?.price).toBe("65000");
    expect(view.values.cash?.price).toBe("0.00083333");
    expect(view.values.home?.price).toBeNull();
  });

  it("prices cash in its own unit, and BTC in bitcoin, at one", () => {
    expect(holdingsValuation(base).values.cash?.price).toBe("1");
    expect(holdingsValuation({ ...base, unit: "btc" }).values.btc?.price).toBe(
      "1",
    );
  });

  it("has no price when the unit's rate is missing", () => {
    const view = holdingsValuation({
      ...base,
      snapshot: { ...SNAPSHOT, fx: {} },
    });
    expect(view.values.btc?.price).toBeNull();
  });

  it("gives each value its share of the total, to one decimal", () => {
    const view = holdingsValuation(base);
    expect(["btc", "cash", "home"].map((id) => view.values[id]?.share)).toEqual(
      SHARES,
    );
  });

  it("has no price or share without a quote", () => {
    const view = holdingsValuation({
      ...base,
      snapshot: { ...SNAPSHOT, prices: {} },
    });
    expect(view.values.btc).toMatchObject({ price: null, share: null });
  });

  it("splits each account and the whole by kind", () => {
    const view = holdingsValuation(base);
    const value = (subset: Holding[]) =>
      valueHoldings(subset, SNAPSHOT, {
        denominator: "ars",
        referenceDollar: "mep",
      }).total;
    const [btc, cash, home] = HOLDINGS as [Holding, Holding, Holding];
    const part = (subset: Holding[]) =>
      expect.objectContaining({
        value: subset.length === 0 ? "0" : value(subset),
        complete: true,
        count: subset.length,
      });
    expect(view.accounts.a1).toEqual({
      cash: part([cash]),
      investments: part([btc]),
      other: part([]),
      total: part([btc, cash]),
    });
    expect(view.kinds.other).toEqual(part([home]));
  });
});

describe("holdingsValuation shares", () => {
  it("gives each part its share of the whole, and the classes add up", () => {
    const view = holdingsValuation(base);
    expect(view.kinds.total.share).toBe("100");
    expect(
      ["crypto", "cash", "real_estate"].map(
        (key) => view.classes[key as HoldingClass]?.share,
      ),
    ).toEqual(SHARES);
    expect(Object.keys(view.classes)).toHaveLength(3);
  });

  it("has no share for a part none of whose holdings had a quote", () => {
    const view = holdingsValuation({
      ...base,
      snapshot: { ...SNAPSHOT, prices: {} },
    });
    expect(view.kinds.investments).toMatchObject({ missing: 1, share: null });
    expect(view.classes.crypto?.share).toBeNull();
    expect(view.kinds.cash.share).not.toBeNull();
  });

  it("sums an instrument across its holdings, other classes left out", () => {
    const second = holding({
      id: "btc2",
      portfolio_id: "p2",
      asset_class: "instrument",
      instrument_symbol: "BTC",
      amount: "0.25",
    });
    const both = [...HOLDINGS, second];
    const view = holdingsValuation({
      ...base,
      holdings: rows(both).map((row) =>
        row.holding.id === "btc2" ? { ...row, account: { id: "a2" } } : row,
      ),
    });
    const btc = valueHoldings([HOLDINGS[0]!, second], SNAPSHOT, {
      denominator: "ars",
      referenceDollar: "mep",
    });
    expect(Object.keys(view.instruments)).toEqual(["BTC"]);
    expect(view.instruments.BTC).toMatchObject({
      value: btc.total,
      count: 2,
      missing: 0,
    });
    // The share of the exact sum, not the sum of the rounded shares.
    // BTC is the only crypto, so its class carries the same exact share.
    expect(view.instruments.BTC?.share).toBe(view.classes.crypto?.share);
  });

  it("has no share for a part with no holding", () => {
    expect(holdingsValuation(base).accounts.a1?.other.share).toBeNull();
  });

  it("has no price too small for its decimals", () => {
    const view = holdingsValuation({
      ...base,
      unit: "btc",
      snapshot: {
        ...SNAPSHOT,
        prices: {
          ...SNAPSHOT.prices,
          BTC: { price: "1000000000", currency: "USD", date: "2026-10-12" },
        },
      },
    });
    expect(view.values.cash?.price).toBeNull();
  });

  it("has no share when the whole is not positive", () => {
    const view = holdingsValuation({
      ...base,
      holdings: rows(HOLDINGS.filter((h) => h.id === "btc")),
      snapshot: { ...SNAPSHOT, prices: {} },
    });
    expect(view.kinds.total.share).toBeNull();
  });
});

describe("holdingName", () => {
  const instruments = instrumentNames([{ symbol: "BTC", name: "Bitcoin" }]);
  it.each([
    ["btc", "BTC · Bitcoin"],
    ["cash", "Efectivo ARS"],
    ["home", "Depto"],
  ])("names %s %j", (id, name) => {
    expect(
      holdingName(
        HOLDINGS.find((h) => h.id === id)!,
        instruments,
      ),
    ).toBe(name);
  });
});

it("names a holding in a sentence by where it is", () => {
  expect(
    holdingInSentence(
      {
        holding: HOLDINGS[0]!,
        account: { institution: "IOL" },
        portfolio: { name: "Largo plazo" },
      },
      instrumentNames([{ symbol: "BTC", name: "Bitcoin" }]),
    ),
  ).toBe("BTC · Bitcoin de IOL en Largo plazo");
});
