import { exactOf, minus, plus, stored } from "@plant/shared";

import {
  adjustment,
  income,
  ratesOf,
  trade,
  yielded,
} from "./fixtures.test-support";
import type { Movement } from "./movement";
import { compareMovements } from "./order";
import {
  EMPTY_POSITION,
  type LedgerStep,
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

// Every money figure of every step fits numeric(20, 8).
const expectStoredPrecision = (steps: readonly LedgerStep[]) => {
  for (const { position } of steps) {
    for (const value of Object.values(position.money ?? {})) {
      expect(value).toMatch(/^-?\d{1,15}(\.\d{1,8})?$/);
    }
  }
};

describe("replay", () => {
  const steps = replay(HISTORY, "usd_mep", "mep");

  it("keeps what the units held were bought for, charges apart", () => {
    expect(steps[1]!.position).toEqual({
      quantity: "20",
      money: { cost: "3000", charges: "6", income: "0", realized: "0" },
    });
  });

  it("costs a partial sale at its oldest units", () => {
    // The 5 sold come out of the 10 at 100.
    expect(steps[2]!.sale).toEqual({
      gross: "1500",
      charges: "3",
      cost: "500",
      result: "997",
    });
    expect(steps[2]!.position).toEqual({
      quantity: "15",
      money: { cost: "2500", charges: "9", income: "0", realized: "997" },
    });
  });

  it("keeps income apart from cost and results", () => {
    expect(positionOf(steps).money).toMatchObject({
      cost: "2500",
      income: "12",
      realized: "997",
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
    const sale = trade("sale", "15", "300", {
      date: "2026-03-02",
      fees: "2",
      taxes: "1",
    });
    const backDated = trade("purchase", "20", "50", { date: "2026-01-20" });
    const saleOf = (movements: Movement[]) =>
      replay(movements.sort(compareMovements), "usd_mep", "mep").at(-1)!.sale;
    // Without it: 10 at 100 and 5 at 200. With it: 10 at 100 and 5 at 50.
    expect(saleOf([...HISTORY.slice(0, 2), sale])).toMatchObject({
      cost: "2000",
      result: "2497",
    });
    expect(saleOf([...HISTORY.slice(0, 2), backDated, sale])).toMatchObject({
      cost: "1250",
      result: "3247",
    });
  });

  it("adds units at their cost and takes the oldest out, with no result", () => {
    const adjusted = replay(
      [
        ...HISTORY.slice(0, 2),
        adjustment("in", "5", { date: "2026-02-10", price: "0" }),
        adjustment("out", "5", { date: "2026-02-20" }),
      ],
      "usd_mep",
      "mep",
    );
    expect(adjusted[2]!.position.money?.cost).toBe("3000");
    // The 5 out are 5 of the 10 at 100.
    expect(adjusted[3]!.position).toEqual({
      quantity: "20",
      money: { cost: "2500", charges: "6", income: "0", realized: "0" },
    });
    expect(adjusted[3]).not.toHaveProperty("sale");
  });

  it("sells what was bought the same day", () => {
    const sameDay = [
      trade("opening_balance", "10", "100", { date: "2026-01-05" }),
      trade("purchase", "5", "100", { date: "2026-02-02" }),
      trade("sale", "15", "120", { date: "2026-02-02" }),
    ];
    expect(positionOf(replay(sameDay, "usd_mep", "mep")).quantity).toBe("0");
  });

  describe("a sell-out and a purchase on one day", () => {
    const before = trade("purchase", "10", "10", { date: "2026-02-01" });
    const replayed = (sameDay: Movement[]) =>
      replay([...sameDay, before].sort(compareMovements), "usd_mep", "mep");

    it("opens a new cost for a buy-back entered after the sale", () => {
      const [, sold, bought] = replayed([
        trade("purchase", "10", "20", { date: "2026-02-02", entry_order: 2 }),
        trade("sale", "10", "15", { date: "2026-02-02", entry_order: 1 }),
      ]);
      expect(sold!.sale!.cost).toBe("100");
      expect(bought!.position.money!.cost).toBe("200");
    });

    it("costs the sale on the older purchase when the purchase was entered first", () => {
      const steps = replayed([
        trade("sale", "10", "15", { date: "2026-02-02", entry_order: 2 }),
        trade("purchase", "10", "20", { date: "2026-02-02", entry_order: 1 }),
      ]);
      // The 10 sold are the 10 at 10 bought the day before.
      expect(steps[2]!.sale!.cost).toBe("100");
    });
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
    expectStoredPrecision(steps);
  });
});

describe("first in, first out", () => {
  const view = (movements: Movement[]) => replay(movements, "usd_mep", "mep");

  it("costs a sale across two lots at each one's own cost", () => {
    // 10 at 100, then 2 of the 10 at 200.
    const steps = view([
      ...HISTORY.slice(0, 2),
      trade("sale", "12", "300", { date: "2026-03-02" }),
    ]);
    expect(steps[2]!.sale!.cost).toBe("1400");
  });

  it("costs a sale in pesos at each lot's own date's dollar", () => {
    // 10 at 100 at a MEP of 1000, then 2 of the 10 at 200 at 1100; the sale's
    // MEP of 1200 prices none of them.
    const steps = replay(
      [
        ...HISTORY.slice(0, 2),
        trade("sale", "12", "300", { date: "2026-03-02" }),
      ],
      "ars",
      "mep",
    );
    expect(steps[2]!.sale!.cost).toBe("1440000");
    expect(positionOf(steps).money!.cost).toBe("1760000");
  });

  it("splits a lot exactly, so selling it all takes all it cost", () => {
    // 0.3 units costing 10, sold a tenth at a time.
    const steps = view([
      trade("purchase", "0.3", "33.33333333", { date: "2026-01-05" }),
      trade("sale", "0.1", "40", { date: "2026-02-01" }),
      trade("sale", "0.1", "40", { date: "2026-02-02" }),
      trade("sale", "0.1", "40", { date: "2026-02-03" }),
    ]);
    expect(steps.slice(1).map((step) => step.sale!.cost)).toEqual([
      "3.33333333",
      "3.33333333",
      "3.33333334",
    ]);
    expect(positionOf(steps).money!.cost).toBe("0");
  });

  it("takes a yield's units out of the oldest lot", () => {
    // 5 of the 10 at 100 leave worth 110 each.
    const steps = view([
      ...HISTORY.slice(0, 2),
      yielded("out", "5", "110", { date: "2026-03-02" }),
    ]);
    expect(positionOf(steps).money).toMatchObject({
      cost: "2500",
      realized: "50",
    });
  });

  describe("a long history that empties its lots", () => {
    // Each sale leaves 0.2 units, so nearly every lot empties.
    const movements: Movement[] = [
      trade("opening_balance", "1", "10.12345678", { date: "2010-01-01" }),
    ];
    let held = exactOf("1");
    for (let i = 1; i < 5000; i += 1) {
      const day = new Date(Date.UTC(2010, 0, 1 + i)).toISOString().slice(0, 10);
      if (i % 3 === 0) {
        const sold = minus(held, exactOf("0.2"));
        movements.push(
          trade("sale", stored(sold), `${5 + (i % 11)}.1234567`, {
            date: day,
            fees: "0.01",
          }),
        );
        held = exactOf("0.2");
      } else {
        movements.push(
          trade("purchase", "0.7", `${3 + (i % 13)}.98765431`, { date: day }),
        );
        held = plus(held, exactOf("0.7"));
      }
    }
    movements.push(trade("sale", stored(held), "9", { date: "2023-12-31" }));
    const steps = view(movements);

    it("leaves no cost once it is all sold", () => {
      expect(positionOf(steps)).toMatchObject({
        quantity: "0",
        money: { cost: "0" },
      });
    });

    it("keeps every step's state within its stored precision", () => {
      expectStoredPrecision(steps);
    });
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
