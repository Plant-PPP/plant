import { compareExact, exactOf, times, toDecimal } from "@plant/shared";
import { DENOMINATORS, type Denominator } from "./denominators";
import { SNAPSHOT } from "./fixtures.test-support";
import { type Holding, holdingSchema } from "./holding";
import { valueHoldings } from "./holdings";

const base = {
  instrument_symbol: null,
  currency: null,
  annual_rate: null,
  started_on: null,
  matures_on: null,
  valued_on: null,
  label: null,
};

// Portfolio p1: 0.5 BTC (USD 32500) and ARS 120,000 cash.
// Portfolio p2: a fixed term of ARS 100,000 at 36.5% from 2026-10-02
// (10 days to the snapshot: ARS 1000 of interest), a USD 50,000 property and
// ARS 30,000 of other.
const HOLDINGS: Holding[] = [
  {
    id: "btc",
    portfolio_id: "p1",
    asset_class: "instrument",
    instrument_symbol: "BTC",
    amount: "0.5",
  },
  {
    id: "cash",
    portfolio_id: "p1",
    asset_class: "cash",
    currency: "ARS",
    amount: "120000",
  },
  {
    id: "term",
    portfolio_id: "p2",
    asset_class: "fixed_term",
    currency: "ARS",
    amount: "100000",
    annual_rate: "0.365",
    started_on: "2026-10-02",
    matures_on: "2026-11-01",
  },
  {
    id: "home",
    portfolio_id: "p2",
    asset_class: "real_estate",
    currency: "USD",
    amount: "50000",
    valued_on: "2026-09-01",
    label: "Depto",
  },
  {
    id: "car",
    portfolio_id: "p2",
    asset_class: "other",
    currency: "ARS",
    amount: "30000",
    valued_on: "2026-10-01",
    label: "Auto",
  },
].map((holding) => holdingSchema.parse({ ...base, ...holding }));

// Pesos: p1 ARS 120,000; p2 ARS 131,000. Dollars: p1 USD 32,500; p2 USD 50,000.
// MEP 1200, CCL 1250, official 1000, BTC 65000 USD (78,000,000 pesos).
const TOTALS: [
  Denominator,
  "mep" | "ccl",
  Record<"p1" | "p2" | "all", string>,
][] = [
  // 32,500 × 1200 + 120,000; 101,000 + 50,000 × 1200 + 30,000.
  ["ars", "mep", { p1: "39120000", p2: "60131000", all: "99251000" }],
  ["ars", "ccl", { p1: "40745000", p2: "62631000", all: "103376000" }],
  // 32,500 + 120,000 / 1200; 131,000 / 1200 + 50,000 = 50,109.1666…
  ["usd_mep", "mep", { p1: "32600", p2: "50109.17", all: "82709.17" }],
  ["usd_ccl", "mep", { p1: "32596", p2: "50104.8", all: "82700.8" }],
  ["usd_official", "mep", { p1: "32620", p2: "50131", all: "82751" }],
  // 120,000 / 78,000,000 + 0.5; 131,000 / 78,000,000 + 50,000 / 65,000.
  ["btc", "mep", { p1: "0.50153846", p2: "0.77091026", all: "1.27244872" }],
];

describe("valueHoldings", () => {
  it.each(TOTALS)(
    "totals the holdings in %s (reference %s)",
    (denominator, referenceDollar, totals) => {
      for (const portfolio of ["p1", "p2", "all"] as const) {
        const value = valueHoldings(HOLDINGS, SNAPSHOT, {
          denominator,
          referenceDollar,
          ...(portfolio !== "all" && { portfolioId: portfolio }),
        });
        expect([portfolio, value.total]).toEqual([
          portfolio,
          totals[portfolio],
        ]);
        expect(
          toDecimal(value.exactTotal, DENOMINATORS[denominator].scale),
        ).toBe(value.total);
        expect(value.complete).toBe(true);
      }
    },
  );

  it.each(["mep", "ccl"] as const)(
    "reconciles pesos with the %s dollar exactly",
    (dollar) => {
      const pesos = valueHoldings(HOLDINGS, SNAPSHOT, {
        denominator: "ars",
        referenceDollar: dollar,
      });
      const dollars = valueHoldings(HOLDINGS, SNAPSHOT, {
        denominator: `usd_${dollar}`,
        referenceDollar: dollar,
      });
      const rate = exactOf(SNAPSHOT.fx[dollar]!.sell);
      expect(
        compareExact(pesos.exactTotal, times(dollars.exactTotal, rate)),
      ).toBe(0);
    },
  );

  it("reconciles BTC with USD MEP and the BTC price exactly", () => {
    const btc = valueHoldings(HOLDINGS, SNAPSHOT, {
      denominator: "btc",
      referenceDollar: "mep",
    });
    const mep = valueHoldings(HOLDINGS, SNAPSHOT, {
      denominator: "usd_mep",
      referenceDollar: "mep",
    });
    expect(
      compareExact(times(btc.exactTotal, exactOf("65000")), mep.exactTotal),
    ).toBe(0);
  });

  it("values one BTC held at exactly one in BTC", () => {
    const one = holdingSchema.parse({
      ...base,
      id: "x",
      portfolio_id: "p",
      asset_class: "instrument",
      instrument_symbol: "BTC",
      amount: "1",
    });
    expect(
      valueHoldings([one], SNAPSHOT, {
        denominator: "btc",
        referenceDollar: "ccl",
      }).total,
    ).toBe("1");
  });

  it("dates each item by the oldest quote behind it", () => {
    const { items } = valueHoldings(HOLDINGS, SNAPSHOT, {
      denominator: "usd_mep",
      referenceDollar: "mep",
    });
    expect(Object.fromEntries(items.map(({ id, asOf }) => [id, asOf]))).toEqual(
      {
        btc: "2026-10-12",
        cash: "2026-10-09",
        term: "2026-10-09",
        home: "2026-09-01",
        car: "2026-10-01",
      },
    );
  });

  // Each item is rounded on its own: ARS 101,000 / 1200 = 84.1666… → 84.17.
  it.each([
    [
      "ars",
      {
        btc: "39000000",
        cash: "120000",
        term: "101000",
        home: "60000000",
        car: "30000",
      },
    ],
    [
      "usd_mep",
      { btc: "32500", cash: "100", term: "84.17", home: "50000", car: "25" },
    ],
    [
      "btc",
      {
        btc: "0.5",
        cash: "0.00153846",
        term: "0.00129487",
        home: "0.76923077",
        car: "0.00038462",
      },
    ],
  ] as const)("shows each item in %s", (denominator, values) => {
    const { items } = valueHoldings(HOLDINGS, SNAPSHOT, {
      denominator,
      referenceDollar: "mep",
    });
    expect(
      Object.fromEntries(items.map(({ id, value }) => [id, value])),
    ).toEqual(values);
  });

  it("tells a matured or not yet started fixed term", () => {
    const term = (id: string, started_on: string, matures_on: string) =>
      holdingSchema.parse({
        ...base,
        id,
        portfolio_id: "p",
        asset_class: "fixed_term",
        currency: "ARS",
        amount: "1000",
        annual_rate: "0.35",
        started_on,
        matures_on,
      });
    const { items } = valueHoldings(
      [
        term("matured", "2026-09-11", "2026-10-11"),
        term("pending", "2026-10-20", "2026-11-19"),
        term("running", "2026-10-02", "2026-11-01"),
      ],
      SNAPSHOT,
      { denominator: "ars", referenceDollar: "mep" },
    );
    expect(
      Object.fromEntries(items.map(({ id, state }) => [id, state])),
    ).toEqual({
      matured: "matured",
      pending: "not_started",
      running: undefined,
    });
  });

  // Dollars held, shown in BTC, need only the BTC price: no dollar rate, so
  // they are dated by it and still valued when the rates are missing.
  it("shows dollars in BTC by the BTC price alone", () => {
    const value = valueHoldings(
      HOLDINGS,
      { ...SNAPSHOT, fx: {} },
      { denominator: "btc", referenceDollar: "mep" },
    );
    expect(value.items.find(({ id }) => id === "btc")).toEqual({
      id: "btc",
      value: "0.5",
      asOf: "2026-10-12",
    });
    expect(value.missing).toEqual(["cash", "term", "car"]);
  });

  // Held dollars reach BTC through USD MEP whatever the reference dollar, and
  // are dated by the BTC price.
  it.each(["mep", "ccl"] as const)(
    "shows USD 65,000 as one BTC (reference %s)",
    (referenceDollar) => {
      const cash = holdingSchema.parse({
        ...base,
        id: "usd",
        portfolio_id: "p",
        asset_class: "cash",
        currency: "USD",
        amount: "65000",
      });
      const snapshot = {
        ...SNAPSHOT,
        prices: {
          BTC: { price: "65000", currency: "USD" as const, date: "2026-10-11" },
        },
      };
      expect(
        valueHoldings([cash], snapshot, { denominator: "btc", referenceDollar })
          .items,
      ).toEqual([{ id: "usd", value: "1", asOf: "2026-10-11" }]);
    },
  );

  const cash = (id: string, amount: string) =>
    holdingSchema.parse({
      ...base,
      id,
      portfolio_id: "p",
      asset_class: "cash",
      currency: "ARS",
      amount,
    });

  // 3 × ARS 100 / 1200 = 0.25 exactly, while each item rounds to 0.08.
  it("rounds the total from the exact sum, not from the items", () => {
    const value = valueHoldings(
      [cash("t1", "100"), cash("t2", "100"), cash("t3", "100")],
      SNAPSHOT,
      { denominator: "usd_mep", referenceDollar: "mep" },
    );
    expect(value.items.map(({ value }) => value)).toEqual([
      "0.08",
      "0.08",
      "0.08",
    ]);
    expect(value.total).toBe("0.25");
  });

  // ARS 0.125 is 0.13 in pesos; in dollars it rounds to 0 at two digits.
  it.each([
    ["ars", "0.13"],
    ["usd_mep", "0"],
    ["usd_ccl", "0"],
    ["usd_official", "0"],
    ["btc", "0"],
  ] as const)("rounds a total in %s to its scale", (denominator, total) => {
    expect(
      valueHoldings([cash("c", "0.125")], SNAPSHOT, {
        denominator,
        referenceDollar: "mep",
      }).total,
    ).toBe(total);
  });

  it("lists a holding with no quote and leaves it out of the total", () => {
    const value = valueHoldings(
      HOLDINGS,
      { ...SNAPSHOT, prices: {} },
      {
        denominator: "usd_mep",
        referenceDollar: "mep",
      },
    );
    expect(value.complete).toBe(false);
    expect(value.missing).toEqual(["btc"]);
    expect(value.items.find(({ id }) => id === "btc")).toEqual({
      id: "btc",
      value: null,
      asOf: null,
      missing: "BTC",
    });
    expect(value.total).toBe("50209.17");
  });

  it("totals nothing as zero", () => {
    expect(
      valueHoldings([], SNAPSHOT, {
        denominator: "ars",
        referenceDollar: "mep",
      }),
    ).toMatchObject({
      total: "0",
      complete: true,
      items: [],
    });
  });
});
