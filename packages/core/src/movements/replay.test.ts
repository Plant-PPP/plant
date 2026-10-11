import { income, ratesOf, trade } from "./fixtures.test-support";
import type { Movement } from "./movement";
import {
  EMPTY_POSITION,
  PositionError,
  positionOf,
  replay,
  unrealized,
} from "./replay";

// 10 at 100 and 10 at 200 (USD), then 5 sold at 300 and a dividend of 12.
const HISTORY: Movement[] = [
  trade("opening_balance", "10", "100", {
    date: "2026-01-05",
    fees: "5",
    taxes: "1",
    rates: ratesOf("2026-01-05", { mep: "1000", ccl: "1050" }),
  }),
  trade("purchase", "10", "200", {
    date: "2026-02-02",
    rates: ratesOf("2026-02-02", { mep: "1100", ccl: "1150" }),
  }),
  trade("sale", "5", "300", { date: "2026-03-02", fees: "2", taxes: "1" }),
  income("dividend", "12", { date: "2026-04-01" }),
];

describe("replay", () => {
  const steps = replay(HISTORY, "usd_mep", "mep");

  it("keeps the average cost over purchases, fees and taxes apart", () => {
    expect(steps[1]!.position).toEqual({
      quantity: "20",
      money: {
        cost: "3000",
        fees: "5",
        taxes: "1",
        income: "0",
        realized: "0",
      },
    });
  });

  it("gives a partial sale its share of the average cost", () => {
    expect(steps[2]!.sale).toEqual({
      gross: "1500",
      fees: "2",
      taxes: "1",
      cost: "750",
      result: "747",
    });
    expect(steps[2]!.position).toEqual({
      quantity: "15",
      money: {
        cost: "2250",
        fees: "7",
        taxes: "2",
        income: "0",
        realized: "747",
      },
    });
  });

  it("keeps income apart from cost and results", () => {
    expect(positionOf(steps).money).toMatchObject({
      cost: "2250",
      income: "12",
      realized: "747",
    });
    expect(steps[3]).not.toHaveProperty("sale");
  });

  it("costs a USD purchase in pesos at that date's reference dollar", () => {
    const twoBuys = HISTORY.slice(0, 2);
    expect(positionOf(replay(twoBuys, "ars", "mep")).money?.cost).toBe(
      "3200000",
    );
    expect(positionOf(replay(twoBuys, "ars", "ccl")).money?.cost).toBe(
      "3350000",
    );
  });

  it("keeps a USD cost at face value in any dollar", () => {
    expect(
      positionOf(replay(HISTORY.slice(0, 2), "usd_ccl", "mep")).money?.cost,
    ).toBe("3000");
  });

  it("costs a peso purchase in dollars at that date's rate", () => {
    const pesos = [
      trade("opening_balance", "10", "120000", {
        date: "2026-03-02",
        currency: "ARS",
      }),
    ];
    expect(positionOf(replay(pesos, "usd_mep", "mep")).money?.cost).toBe(
      "1000",
    );
  });

  it("has no money in a unit no stored rate reaches, but keeps the quantity", () => {
    const btc = replay(HISTORY, "btc", "mep");
    expect(positionOf(btc)).toEqual({ quantity: "15", money: null });
    expect(btc[2]!.sale).toBeNull();
  });

  it("leaves no cost once every unit is sold", () => {
    const thirds = [
      trade("opening_balance", "3", "3.33333333", { date: "2026-01-05" }),
      trade("sale", "1", "4", { date: "2026-02-02" }),
      trade("sale", "2", "4", { date: "2026-03-02" }),
    ];
    const position = positionOf(replay(thirds, "usd_mep", "mep"));
    expect(position.quantity).toBe("0");
    expect(position.money?.cost).toBe("0");
    expect(position.money?.realized).toBe("2.00000001");
  });

  it("changes a later sale's result when a purchase is back-dated before it", () => {
    const backDated = trade("purchase", "20", "50", { date: "2026-02-20" });
    const withIt = replay(
      [...HISTORY.slice(0, 2), backDated, ...HISTORY.slice(2)],
      "usd_mep",
      "mep",
    );
    expect(withIt[3]!.sale?.cost).toBe("500");
    expect(steps[2]!.sale?.cost).toBe("750");
  });

  it("sells what was bought the same day", () => {
    const sameDay = [
      trade("opening_balance", "10", "100", { date: "2026-01-05" }),
      trade("purchase", "5", "100", { date: "2026-02-02" }),
      trade("sale", "15", "120", { date: "2026-02-02" }),
    ];
    expect(positionOf(replay(sameDay, "usd_mep", "mep")).quantity).toBe("0");
  });

  it("throws on a sale of more than is held", () => {
    const oversold = [
      trade("opening_balance", "1", "100", { date: "2026-01-05" }),
      trade("sale", "2", "100", { date: "2026-02-02" }),
    ];
    expect(() => replay(oversold, "usd_mep", "mep")).toThrow(
      new PositionError("oversold"),
    );
    expect(new PositionError("oversold").message).toBe("oversold");
  });

  it("gives the same steps resumed from any stored step", () => {
    for (let k = 1; k < HISTORY.length; k += 1) {
      expect(
        replay(HISTORY.slice(k), "ars", "mep", {
          from: replay(HISTORY, "ars", "mep")[k - 1]!.position,
        }),
      ).toEqual(replay(HISTORY, "ars", "mep").slice(k));
    }
  });

  it("starts empty", () => {
    expect(positionOf([])).toEqual(EMPTY_POSITION);
  });
});

describe("a long history", () => {
  // Odd prices and partial sales, so exact sums would grow without bound.
  const movements: Movement[] = [
    trade("opening_balance", "1000", "1.23456789", { date: "2010-01-01" }),
  ];
  for (let i = 1; i < 5000; i += 1) {
    const day = new Date(Date.UTC(2010, 0, 1 + i)).toISOString().slice(0, 10);
    movements.push(
      i % 3 === 0
        ? trade("sale", "0.33333333", `${7 + (i % 11)}.1234567`, {
            date: day,
            fees: "0.01",
          })
        : trade("purchase", "0.7", `${3 + (i % 13)}.98765431`, {
            date: day,
            taxes: "0.03",
          }),
    );
  }
  const steps = replay(movements, "ars", "mep");

  it("keeps every step's state within its stored precision", () => {
    for (const { position } of steps) {
      for (const value of Object.values(position.money ?? {})) {
        expect(value).toMatch(/^-?\d{1,15}(\.\d{1,8})?$/);
      }
    }
  });

  it("resumes from the middle with the same steps", () => {
    expect(
      replay(movements.slice(2500), "ars", "mep", {
        from: steps[2499]!.position,
      }),
    ).toEqual(steps.slice(2500));
  });
});

describe("unrealized", () => {
  it("gives the amount over cost and its share", () => {
    expect(unrealized("3000", "3600")).toEqual({ amount: "600", share: "0.2" });
    expect(unrealized("3000", "2400")).toEqual({
      amount: "-600",
      share: "-0.2",
    });
  });

  it("has no share of a zero cost", () => {
    expect(unrealized("0", "10")).toEqual({ amount: "10", share: null });
  });
});
