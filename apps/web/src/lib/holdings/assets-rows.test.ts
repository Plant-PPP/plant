import { holdingSchema, type Position } from "@plant/core";

import { byHolding, byInstrument, holdingsOf, rowFigures } from "./assets-rows";
import type { HoldingRow } from "./read";
import type { HoldingsValuation, Sum } from "./valuation-view";

const IOL = { id: "a1", institution: "IOL" };
const BINANCE = { id: "a2", institution: "Binance" };
const PRINCIPAL = { id: "p1", name: "Principal" };
const LARGO = { id: "p2", name: "Largo plazo" };

const base = {
  instrument_symbol: null,
  currency: null,
  annual_rate: null,
  started_on: null,
  matures_on: null,
  valued_on: null,
  label: null,
};

const eth = (
  id: string,
  amount: string,
  account = IOL,
  portfolio = PRINCIPAL,
): HoldingRow => ({
  id,
  holding: holdingSchema.parse({
    ...base,
    id,
    portfolio_id: portfolio.id,
    asset_class: "instrument",
    instrument_symbol: "ETH",
    amount,
  }),
  account,
  portfolio,
  instrumentType: "crypto",
});

const cash = (id: string): HoldingRow => ({
  id,
  holding: holdingSchema.parse({
    ...base,
    id,
    portfolio_id: PRINCIPAL.id,
    asset_class: "cash",
    currency: "ARS",
    amount: "1000",
  }),
  account: IOL,
  portfolio: PRINCIPAL,
  instrumentType: null,
});

const sum = (value: string, share: string | null, missing = 0): Sum => ({
  value,
  complete: missing === 0,
  count: 2,
  missing,
  share,
});

const valued = (value: string | null, asOf: string | null, price = "2000") => ({
  value,
  asOf,
  price: value === null ? null : price,
  share: value === null ? null : "10.0",
});

const VALUATION = {
  values: {
    e1: valued("2000", "2026-10-12"),
    e2: valued("1000", "2026-10-10"),
    c1: valued("1000", "2026-10-12"),
  },
  instruments: { ETH: sum("3000", "60.0") },
} as unknown as Pick<HoldingsValuation, "values" | "instruments">;

const position = (quantity: string, cost: string | null): Position => ({
  quantity,
  money:
    cost === null ? null : { cost, charges: "0", income: "0", realized: "0" },
});

describe("byInstrument", () => {
  it("merges an instrument's holdings and keeps every other holding alone", () => {
    const rows = byInstrument([
      eth("e1", "1", IOL, PRINCIPAL),
      cash("c1"),
      eth("e2", "0.5", BINANCE, LARGO),
    ]);
    expect(rows.map((row) => row.id)).toEqual(["instrument:ETH", "c1"]);
    expect(holdingsOf(rows[0]!).map((row) => row.id)).toEqual(["e1", "e2"]);
    expect(rows[1]).toMatchObject({ kind: "holding", id: "c1" });
  });

  it("keeps every holding alone, each row by its holding's id", () => {
    const rows = byHolding([eth("e1", "1"), eth("e2", "0.5")]);
    expect(rows.map((row) => [row.kind, row.id])).toEqual([
      ["holding", "e1"],
      ["holding", "e2"],
    ]);
  });
});

describe("rowFigures", () => {
  const [merged] = byInstrument([
    eth("e1", "1", IOL, PRINCIPAL),
    eth("e2", "0.5", BINANCE, LARGO),
  ]);

  it("adds up an instrument's units and takes its exact sum and share", () => {
    expect(rowFigures(merged!, { valuation: VALUATION })).toMatchObject({
      quantity: "1.5",
      accounts: [IOL, BINANCE],
      portfolios: [PRINCIPAL, LARGO],
      value: "3000",
      share: "60.0",
      asOf: "2026-10-10",
      price: "2000",
      cost: null,
    });
  });

  it("names an account or portfolio once however many holdings it has", () => {
    const [twiceInIol] = byInstrument([
      eth("e1", "1", IOL, PRINCIPAL),
      eth("e2", "0.5", IOL, LARGO),
      eth("e3", "0.5", BINANCE, LARGO),
    ]);
    expect(rowFigures(twiceInIol!, { valuation: VALUATION })).toMatchObject({
      accounts: [IOL, BINANCE],
      portfolios: [PRINCIPAL, LARGO],
    });
  });

  it("has no value or share when a holding of it has no quote", () => {
    const figures = rowFigures(merged!, {
      valuation: {
        ...VALUATION,
        instruments: { ETH: sum("2000", "40.0", 1) },
      },
    });
    expect(figures).toMatchObject({ value: null, share: null });
  });

  it("counts cost and units only where a holding has movements", () => {
    const figures = rowFigures(merged!, {
      valuation: VALUATION,
      positions: new Map([["e1", position("1", "1500")]]),
    });
    expect(figures.cost).toEqual({
      count: 1,
      cost: "1500",
      gain: { amount: "500", percent: "33.3" },
      quantity: "1",
    });
  });

  it("takes an instrument's gain over the exact sum its row shows", () => {
    const [both] = byInstrument([eth("e1", "0.5"), eth("e2", "0.5", BINANCE)]);
    const figures = rowFigures(both!, {
      valuation: {
        values: {
          e1: valued("500.01", "2026-10-12"),
          e2: valued("500.01", "2026-10-12"),
        },
        // 1000.01 split in two halves of 500.005, each rounded up alone.
        instruments: { ETH: sum("1000.01", "100.0") },
      } as unknown as Pick<HoldingsValuation, "values" | "instruments">,
      positions: new Map([
        ["e1", position("0.5", "500")],
        ["e2", position("0.5", "500")],
      ]),
    });
    expect(figures.cost?.gain?.amount).toBe("0.01");
  });

  it("prices an instrument from a holding of it that has a quote", () => {
    const figures = rowFigures(merged!, {
      valuation: {
        ...VALUATION,
        values: { ...VALUATION.values, e1: valued(null, null) },
      } as unknown as Pick<HoldingsValuation, "values" | "instruments">,
    });
    expect(figures.price).toBe("2000");
  });

  it("has no gain when a holding of it with movements has no quote", () => {
    const figures = rowFigures(merged!, {
      valuation: {
        values: { ...VALUATION.values, e2: valued(null, null) },
        instruments: { ETH: sum("2000", "40.0", 1) },
      } as unknown as Pick<HoldingsValuation, "values" | "instruments">,
      positions: new Map([
        ["e1", position("1", "1500")],
        ["e2", position("0.5", "500")],
      ]),
    });
    expect(figures.cost).toMatchObject({ count: 2, cost: "2000", gain: null });
  });

  it("has no cost or gain when a holding's cost is not in the unit", () => {
    const figures = rowFigures(merged!, {
      valuation: VALUATION,
      positions: new Map([
        ["e1", position("1", "1500")],
        ["e2", position("0.5", null)],
      ]),
    });
    expect(figures.cost).toMatchObject({ count: 2, cost: null, gain: null });
  });

  it("reads a single holding's own value", () => {
    const [alone] = byHolding([cash("c1")]);
    expect(rowFigures(alone!, { valuation: VALUATION })).toMatchObject({
      quantity: "1000",
      accounts: [IOL],
      value: "1000",
      share: "10.0",
    });
  });
});
