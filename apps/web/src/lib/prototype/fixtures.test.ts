import { compareDecimals } from "@plant/shared";
import {
  compareMovements,
  DENOMINATORS,
  type Denominator,
  positionOf,
  quotesNeeded,
  readSnapshot,
  replay,
  valueHoldings,
} from "@plant/core";
import { z } from "zod";

import { buildFixtures } from "./fixtures";
import { createFixtureQuoteReader } from "./quote-reader";

const TODAY = "2026-10-12";
const fixtures = buildFixtures(TODAY);

it("gives the same data for the same day", () => {
  expect(buildFixtures(TODAY)).toEqual(fixtures);
});

it("uses uuids for every id", () => {
  const ids = [
    ...fixtures.accounts.map((row) => row.id),
    ...fixtures.portfolios.map((row) => row.id),
    ...fixtures.holdings.map((row) => row.id),
    ...fixtures.movements.map((row) => row.id),
  ];
  for (const id of ids) expect(z.uuid().safeParse(id).success).toBe(true);
  expect(new Set(ids).size).toBe(ids.length);
});

it("holds instruments, cash, placements at a rate and an apartment", () => {
  expect(
    new Set(fixtures.holdings.map((row) => row.holding.asset_class)),
  ).toEqual(new Set(["instrument", "cash", "fixed_term", "real_estate"]));
});

it("holds a caución that matured, to renew, and a plazo fijo still running", () => {
  const placements = fixtures.holdings.flatMap(({ id, holding }) =>
    holding.asset_class === "fixed_term" ? [{ id, holding }] : [],
  );
  expect(
    placements.map(({ id, holding }) => [
      fixtures.placements?.[id] ?? "fixed_term",
      holding.matures_on < TODAY,
    ]),
  ).toEqual([
    ["caucion", true],
    ["fixed_term", false],
  ]);
});

it("sets each open instrument holding's amount to what its movements leave", () => {
  for (const row of fixtures.holdings) {
    if (row.holding.asset_class !== "instrument") continue;
    const own = fixtures.movements.filter((m) => m.holding_id === row.id);
    const { quantity } = positionOf(replay(own, "ars", "mep"));
    if (fixtures.closed.includes(row.id)) {
      expect(quantity).toBe("0");
    } else {
      expect(compareDecimals(row.holding.amount, quantity)).toBe(0);
    }
  }
  expect(fixtures.closed).toHaveLength(1);
});

it("enters each holding's steps in the order they are listed", () => {
  for (const row of fixtures.holdings) {
    const own = fixtures.movements.filter((m) => m.holding_id === row.id);
    expect([...own].sort(compareMovements)).toEqual(own);
  }
});

it("gives one holding movements for more than one page", () => {
  const counts = new Map<string, number>();
  for (const m of fixtures.movements) {
    counts.set(m.holding_id, (counts.get(m.holding_id) ?? 0) + 1);
  }
  expect(Math.max(...counts.values())).toBeGreaterThan(20);
});

it("replays every holding in every unit", () => {
  for (const unit of Object.keys(DENOMINATORS) as Denominator[]) {
    for (const row of fixtures.holdings) {
      const own = fixtures.movements.filter((m) => m.holding_id === row.id);
      expect(() => replay(own, unit, "mep")).not.toThrow();
    }
  }
});

it("reads today's rates and prices through the quote reader", async () => {
  const { snapshot, invalidCount } = await readSnapshot(
    createFixtureQuoteReader(fixtures.quotes),
    TODAY,
    quotesNeeded(fixtures.holdings.map((row) => row.holding)),
  );
  expect(invalidCount).toBe(0);
  expect(Object.keys(snapshot.fx).sort()).toEqual([
    "ccl",
    "eur",
    "mep",
    "official",
  ]);
  expect(snapshot.fx.mep?.date).toBe(TODAY);
  expect(snapshot.prices.BTC?.date).toBe(TODAY);
  expect(snapshot.prices.KO).toBeUndefined();
});

it("reads each key's latest quote before the range, as the store does", async () => {
  const reader = createFixtureQuoteReader({
    fxRates: [
      { kind: "mep", rate_date: "2026-03-01", sell: "1000" },
      { kind: "mep", rate_date: "2026-09-01", sell: "1300" },
    ],
    prices: [
      {
        symbol: "KO",
        price_date: "2026-09-01",
        price: "9000",
        currency: "ARS",
      },
    ],
  });
  expect(
    await reader.read({
      from: "2026-09-02",
      to: "2026-09-09",
      fxKinds: ["mep", "ccl"],
      symbols: ["KO", "BTC"],
    }),
  ).toEqual({
    fxRates: [{ kind: "mep", rate_date: "2026-09-01", sell: "1300" }],
    prices: [
      {
        symbol: "KO",
        price_date: "2026-09-01",
        price: "9000",
        currency: "ARS",
      },
    ],
  });
});

it("states each manual price in its instrument's currency", () => {
  const symbols = new Set(fixtures.manualPrices.map((row) => row.symbol));
  expect(symbols).toEqual(new Set(["KO", "GD30", "FIMAAHO"]));
  for (const row of fixtures.manualPrices) {
    const instrument = fixtures.instruments.find(
      (each) => each.symbol === row.symbol,
    );
    expect(row.currency).toBe(instrument?.currency);
  }
  expect(
    fixtures.manualPrices.find((row) => row.symbol === "GD30")?.currency,
  ).toBe("USD");
});

describe("each instrument's currency", () => {
  const currencyOf = (symbol: string | null) =>
    fixtures.instruments.find((each) => each.symbol === symbol)?.currency;
  const symbolOf = (holdingId: string) =>
    fixtures.holdings.find((row) => row.id === holdingId)?.holding
      .instrument_symbol ?? null;

  it("states every trade of an instrument holding in the instrument's currency", () => {
    const trades = fixtures.movements.filter((m) => m.kind !== "dividend");
    expect(trades.length).toBeGreaterThan(0);
    for (const m of trades) {
      expect(currencyOf(symbolOf(m.holding_id))).toBeDefined();
      expect(m.currency).toBe(currencyOf(symbolOf(m.holding_id)));
    }
  });

  it("trades a dollar bond in dollars and a peso FCI and bond in pesos", () => {
    const currenciesOf = (symbol: string) =>
      new Set(
        fixtures.movements
          .filter(
            (m) => m.kind !== "dividend" && symbolOf(m.holding_id) === symbol,
          )
          .map((m) => m.currency),
      );
    expect(currenciesOf("GD30")).toEqual(new Set(["USD"]));
    expect(currenciesOf("FIMAAHO")).toEqual(new Set(["ARS"]));
    expect(currenciesOf("TX26")).toEqual(new Set(["ARS"]));
    expect(currenciesOf("AAPL")).toEqual(new Set(["ARS"]));
    expect(currenciesOf("BTC")).toEqual(new Set(["USD"]));
  });

  it("states every fed price in its instrument's currency", () => {
    expect(fixtures.quotes.prices.length).toBeGreaterThan(0);
    for (const quote of fixtures.quotes.prices) {
      expect(currencyOf(quote.symbol)).toBeDefined();
      expect(quote.currency).toBe(currencyOf(quote.symbol));
    }
  });
});

it("holds euros in cash, valued at today's official euro", async () => {
  const holdings = fixtures.holdings.map((row) => row.holding);
  const euros = holdings.filter((holding) => holding.currency === "EUR");
  expect(euros).toHaveLength(1);
  const { snapshot } = await readSnapshot(
    createFixtureQuoteReader(fixtures.quotes),
    TODAY,
    quotesNeeded(holdings),
  );
  const value = valueHoldings(euros, snapshot, {
    denominator: "ars",
    referenceDollar: "mep",
  });
  expect(value.complete).toBe(true);
  expect(compareDecimals(value.total, "0")).toBe(1);
});
