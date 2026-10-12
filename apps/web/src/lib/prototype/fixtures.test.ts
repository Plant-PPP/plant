import { compareDecimals } from "@plant/shared";
import {
  compareMovements,
  DENOMINATORS,
  type Denominator,
  positionOf,
  quotesNeeded,
  readSnapshot,
  replay,
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

it("holds instruments, cash and an apartment", () => {
  expect(
    new Set(fixtures.holdings.map((row) => row.holding.asset_class)),
  ).toEqual(new Set(["instrument", "cash", "real_estate"]));
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
  expect(Object.keys(snapshot.fx).sort()).toEqual(["ccl", "mep", "official"]);
  expect(snapshot.fx.mep?.date).toBe(TODAY);
  expect(snapshot.prices.BTC?.date).toBe(TODAY);
  expect(snapshot.prices.KO).toBeUndefined();
});
