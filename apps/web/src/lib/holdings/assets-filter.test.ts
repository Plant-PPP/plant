import { holdingSchema } from "@plant/core";

import {
  type AssetsFilter,
  parseAssetsParams,
  tabOf,
  matchesFilter,
  SEARCH_MAX_LENGTH,
  tickerOf,
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
  assetClass: null,
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
    expect(shown({ assetClass: "cash" })).toEqual(["cash"]);
  });

  it("searches the name, the ticker and the account, ignoring case and accents", () => {
    expect(shown({ search: "bitcoin" })).toEqual(["btc"]);
    expect(shown({ search: "ars" })).toEqual(["cash"]);
    expect(shown({ search: "credito" })).toEqual(["btc", "home", "cash"]);
  });
});

it("trims a search, and keeps one at the limit once trimmed", () => {
  const search = (buscar: string) =>
    parseAssetsParams({ buscar }, []).filter.search;
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
    ["tenencias", "cuentas", "carteras", "tablero", undefined].map(tabOf),
  ).toEqual(["tenencias", "cuentas", "carteras", "tenencias", "tenencias"]);
});

describe("parseAssetsParams", () => {
  it("reads every param the page takes", () => {
    expect(
      parseAssetsParams(
        {
          moneda: "ars",
          cartera: "p1",
          tipo: "cash",
          buscar: " btc ",
          vista: "cuentas",
        },
        ["p1"],
      ),
    ).toEqual({
      unit: "ars",
      tab: "cuentas",
      filter: { portfolioId: "p1", assetClass: "cash", search: "btc" },
      invalid: {
        unit: false,
        portfolio: false,
        class: false,
        search: false,
        tab: false,
      },
    });
  });

  it("falls back on each invalid param and flags it", () => {
    expect(
      parseAssetsParams(
        {
          moneda: "xyz",
          cartera: "p9",
          tipo: "toString",
          buscar: "x".repeat(SEARCH_MAX_LENGTH + 1),
          vista: ["cuentas", "carteras"],
        },
        ["p1"],
      ),
    ).toEqual({
      unit: null,
      tab: "tenencias",
      filter: { portfolioId: null, assetClass: null, search: "" },
      invalid: {
        unit: true,
        portfolio: true,
        class: true,
        search: true,
        tab: true,
      },
    });
  });

  it("flags nothing for absent params", () => {
    expect(parseAssetsParams({}, []).invalid).toEqual({
      unit: false,
      portfolio: false,
      class: false,
      search: false,
      tab: false,
    });
  });
});
