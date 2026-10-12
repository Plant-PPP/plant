import { holdingSchema } from "@plant/core";

import {
  type AssetsFilter,
  parseAssetsParams,
  SALES_TABS,
  TABS,
  tabOf,
  matchesFilter,
  SEARCH_MAX_LENGTH,
  tickerOf,
  unitParam,
} from "./assets-filter";
import { instrumentNames } from "./holding-name";
import type { HoldingRow } from "./read";

const empty = {
  instrument_symbol: null,
  currency: null,
  annual_rate: null,
  started_on: null,
  matures_on: null,
  valued_on: null,
  label: null,
};

const row = (fields: Record<string, unknown>): HoldingRow => ({
  id: String(fields.id),
  holding: holdingSchema.parse({ ...empty, portfolio_id: "p1", ...fields }),
  account: { id: "a1", institution: "Crédito Uno" },
  instrumentType: fields.asset_class === "instrument" ? "crypto" : null,
  portfolio: { id: "p1", name: "Principal" },
});

const BTC = row({
  id: "btc",
  asset_class: "instrument",
  instrument_symbol: "BTC",
  amount: "0.5",
});
const HOME = row({
  id: "home",
  asset_class: "real_estate",
  currency: "USD",
  amount: "50000",
  valued_on: "2026-10-01",
  label: "Depto",
});
const CASH = row({
  id: "cash",
  asset_class: "cash",
  currency: "ARS",
  amount: "1",
});

const names = instrumentNames([{ symbol: "BTC", name: "Bitcoin" }]);
const ALL: AssetsFilter = {
  portfolioId: null,
  holdingClass: null,
  search: "",
};
const shown = (filter: Partial<AssetsFilter>) =>
  [BTC, HOME, CASH]
    .filter((each) => matchesFilter(each, { ...ALL, ...filter }, names))
    .map((each) => each.id);

describe("matchesFilter", () => {
  it("keeps everything with no filter", () => {
    expect(shown({})).toEqual(["btc", "home", "cash"]);
  });

  it("keeps one portfolio and one class", () => {
    expect(shown({ portfolioId: "p2" })).toEqual([]);
    expect(shown({ holdingClass: "cash" })).toEqual(["cash"]);
  });

  it("searches the name, the ticker and the account, ignoring case and accents", () => {
    expect(shown({ search: "bitcoin" })).toEqual(["btc"]);
    expect(shown({ search: "ars" })).toEqual(["cash"]);
    expect(shown({ search: "credito" })).toEqual(["btc", "home", "cash"]);
  });
});

it("trims a search, and keeps one at the limit once trimmed", () => {
  const search = (raw: string) =>
    parseAssetsParams({ search: raw }, options([])).filter.search;
  expect(search("  btc ")).toBe("btc");
  expect(search(` ${"x".repeat(SEARCH_MAX_LENGTH)} `)).toHaveLength(
    SEARCH_MAX_LENGTH,
  );
});

it("lists an instrument by its symbol and cash by its currency", () => {
  expect([BTC, HOME, CASH].map(tickerOf)).toEqual(["BTC", null, "ARS"]);
});

it("knows the page's tabs, and falls back to the first", () => {
  expect(
    [
      "holdings",
      "accounts",
      "portfolios",
      "tablero",
      "constructor",
      "__proto__",
      "toString",
      "sales",
      undefined,
    ].map((raw) => tabOf(raw, TABS)),
  ).toEqual([
    "holdings",
    "accounts",
    "portfolios",
    "holdings",
    "holdings",
    "holdings",
    "holdings",
    "holdings",
    "holdings",
  ]);
  expect(tabOf("sales", SALES_TABS)).toBe("sales");
});

// A page without movements, with these active portfolios.
const options = (portfolioIds: string[]) => ({
  portfolioIds,
  tabs: TABS,
  salesYears: [],
});

describe("parseAssetsParams", () => {
  it("ignores params it does not read, without flagging them", () => {
    expect(
      parseAssetsParams(
        {
          vista: "cuentas",
          moneda: "ars",
          cartera: "p1",
          tipo: "cash",
          buscar: "btc",
          holdings: "x",
        },
        options(["p1"]),
      ),
    ).toEqual({
      unit: null,
      tab: "holdings",
      year: null,
      filter: { portfolioId: null, holdingClass: null, search: "" },
      invalid: {
        unit: false,
        portfolio: false,
        class: false,
        search: false,
        tab: false,
        year: false,
      },
    });
  });

  it("reads every param the page takes", () => {
    expect(
      parseAssetsParams(
        {
          unit: "ars",
          portfolio: "p1",
          class: "cash",
          search: " btc ",
          tab: "accounts",
        },
        options(["p1"]),
      ),
    ).toEqual({
      unit: "ars",
      tab: "accounts",
      year: null,
      filter: { portfolioId: "p1", holdingClass: "cash", search: "btc" },
      invalid: {
        unit: false,
        portfolio: false,
        class: false,
        search: false,
        tab: false,
        year: false,
      },
    });
  });

  it("falls back on each invalid param and flags it", () => {
    expect(
      parseAssetsParams(
        {
          unit: "xyz",
          portfolio: "p9",
          class: "toString",
          search: "x".repeat(SEARCH_MAX_LENGTH + 1),
          tab: ["accounts", "portfolios"],
        },
        options(["p1"]),
      ),
    ).toEqual({
      unit: null,
      tab: "holdings",
      year: null,
      filter: { portfolioId: null, holdingClass: null, search: "" },
      invalid: {
        unit: true,
        portfolio: true,
        class: true,
        search: true,
        tab: true,
        year: false,
      },
    });
  });

  it("flags nothing for absent params", () => {
    expect(parseAssetsParams({}, options([])).invalid).toEqual({
      unit: false,
      portfolio: false,
      class: false,
      search: false,
      tab: false,
      year: false,
    });
  });

  it("reads the year of the sales tab, the latest by default", () => {
    const sales = {
      portfolioIds: [],
      tabs: SALES_TABS,
      salesYears: ["2026", "2025"],
    };
    expect(parseAssetsParams({ tab: "sales" }, sales)).toMatchObject({
      tab: "sales",
      year: "2026",
      invalid: { tab: false, year: false },
    });
    expect(parseAssetsParams({ year: "2025" }, sales).year).toBe("2025");
    expect(parseAssetsParams({ year: "2019" }, sales)).toMatchObject({
      year: "2026",
      invalid: { year: true },
    });
  });

  it("flags a tab the page does not offer", () => {
    expect(parseAssetsParams({ tab: "sales" }, options([]))).toMatchObject({
      tab: "holdings",
      invalid: { tab: true },
    });
  });
});

it("leaves the reference unit out of the URL", () => {
  expect(unitParam("usd_ccl", "usd_ccl")).toBeNull();
  expect(unitParam("ars", "usd_ccl")).toBe("ars");
});
