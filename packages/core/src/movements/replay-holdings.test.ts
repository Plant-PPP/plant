import { periodResult } from "./period";
import { cashFlowsOf } from "./returns";
import { ratesOf, trade, transfer } from "./fixtures.test-support";
import type { Movement } from "./movement";
import { compareInReplay } from "./order";
import {
  type LedgerStep,
  PositionError,
  positionOf,
  replay,
  replayHoldings,
} from "./replay";

const inHolding = (holding: string, movement: Movement): Movement => ({
  ...movement,
  holding_id: holding,
});
const bought = (
  holding: string,
  quantity: string,
  price: string,
  date: string,
) =>
  inHolding(
    holding,
    trade("purchase", quantity, price, {
      date,
      rates: ratesOf(date, { mep: date < "2026-03-01" ? "1000" : "1300" }),
    }),
  );
// 10 at 100 on 01-05 and 10 at 200 on 02-02 in X: 20 units costing 3000.
const X = [
  bought("x", "10", "100", "2026-01-05"),
  bought("x", "10", "200", "2026-02-02"),
];
const moved = (quantity: string, date: string, price?: string | null) => [
  transfer("out", quantity, { holding: "x", op: `t-${date}`, date }),
  transfer("in", quantity, { holding: "y", op: `t-${date}`, date, price }),
];
const money = (steps: Map<string, unknown[]>, holding: string) =>
  positionOf((steps.get(holding) ?? []) as never).money;

describe("replayHoldings", () => {
  it("moves the oldest units with their cost and no result", () => {
    const steps = replayHoldings(
      [...X, ...moved("5", "2026-03-02")],
      "usd_mep",
      "mep",
    );
    expect(positionOf(steps.get("x")!).quantity).toBe("15");
    // The 5 moved are 5 of the 10 at 100.
    expect(money(steps, "x")).toMatchObject({ cost: "2500", realized: "0" });
    expect(positionOf(steps.get("y")!).quantity).toBe("5");
    expect(money(steps, "y")).toMatchObject({ cost: "500", realized: "0" });
  });

  it("carries the whole cost when every unit moves", () => {
    const steps = replayHoldings(
      [...X, ...moved("20", "2026-03-02")],
      "usd_mep",
      "mep",
    );
    expect(money(steps, "x")).toMatchObject({ cost: "0" });
    expect(money(steps, "y")).toMatchObject({ cost: "3000" });
  });

  it("carries the cost the units had in every unit", () => {
    const all = [...X, ...moved("5", "2026-03-02")];
    for (const view of ["ars", "usd_mep", "usd_ccl"] as const) {
      const steps = replayHoldings(all, view, "mep");
      const before = positionOf(
        replayHoldings(X, view, "mep").get("x")!,
      ).money!;
      expect(money(steps, "y")!.cost).toBe(
        String(Number(before.cost) - Number(money(steps, "x")!.cost)),
      );
    }
  });

  it("takes a manual cost per unit for the units arriving", () => {
    const steps = replayHoldings(
      [...X, ...moved("5", "2026-03-02", "400")],
      "usd_mep",
      "mep",
    );
    expect(money(steps, "y")).toMatchObject({ cost: "2000" });
    expect(money(steps, "x")).toMatchObject({ cost: "2500", realized: "0" });
  });

  it("follows an edit to the history the units left", () => {
    // The 10 moved are the oldest, now bought at 300 instead of 100.
    const edited = [
      bought("x", "10", "300", "2026-01-05"),
      bought("x", "10", "200", "2026-02-02"),
    ];
    const steps = replayHoldings(
      [...edited, ...moved("10", "2026-03-02")],
      "usd_mep",
      "mep",
    );
    expect(money(steps, "y")).toMatchObject({ cost: "3000" });
  });

  it("moves units back and forth", () => {
    const back = [
      transfer("out", "5", { holding: "y", op: "back", date: "2026-03-09" }),
      transfer("in", "5", { holding: "x", op: "back", date: "2026-03-09" }),
    ];
    const steps = replayHoldings(
      [...X, ...moved("10", "2026-03-02"), ...back],
      "usd_mep",
      "mep",
    );
    // The 10 at 100 go and 5 of them come back.
    expect(money(steps, "x")).toMatchObject({ cost: "2500" });
    expect(money(steps, "y")).toMatchObject({ cost: "500" });
  });

  it("knows no cost for units whose leaving cost is unknown", () => {
    const steps = replayHoldings(
      [...X, ...moved("5", "2026-03-02")].map((m) =>
        m.holding_id === "x" && m.kind === "purchase"
          ? ({ ...m, rates: {} } as unknown as Movement)
          : m,
      ),
      "ars",
      "mep",
    );
    expect(money(steps, "y")).toBeNull();
  });

  it("gives holdings without transfers the steps replay gives them", () => {
    expect(replayHoldings(X, "ars", "mep").get("x")).toEqual(
      replay(X, "ars", "mep"),
    );
  });
});

describe("lots carried by a transfer", () => {
  const sold = (holding: string, quantity: string, date: string) =>
    inHolding(holding, trade("sale", quantity, "500", { date }));
  const saleCost = (steps: Map<string, LedgerStep[]>, holding: string) =>
    steps.get(holding)!.at(-1)!.sale!.cost;

  it("sells the units it brought before the newer ones already held", () => {
    // y's own 10 at 50 are newer than the 5 at 100 from x.
    const steps = replayHoldings(
      [
        ...X,
        bought("y", "10", "50", "2026-03-01"),
        ...moved("5", "2026-03-02"),
        sold("y", "5", "2026-03-05"),
      ],
      "usd_mep",
      "mep",
    );
    expect(saleCost(steps, "y")).toBe("500");
  });

  it("spreads a cost set by hand over the units it brought, by quantity", () => {
    // 1 at 10 and 1 at 30 arrive at 25 each.
    const steps = replayHoldings(
      [
        bought("x", "1", "10", "2026-01-05"),
        bought("x", "1", "30", "2026-02-02"),
        ...moved("2", "2026-03-02", "25"),
        sold("y", "1", "2026-03-05"),
      ],
      "usd_mep",
      "mep",
    );
    expect(saleCost(steps, "y")).toBe("25");
    expect(money(steps, "y")).toMatchObject({ cost: "25" });
  });

  it("spreads a cost set by hand over unequal lots by their quantities", () => {
    // 1 at 10 and 3 at 30 arrive at 25 each: the older lot costs 25, the
    // newer 75.
    const steps = replayHoldings(
      [
        bought("x", "1", "10", "2026-01-05"),
        bought("x", "3", "30", "2026-02-02"),
        ...moved("4", "2026-03-02", "25"),
        sold("y", "1", "2026-03-05"),
      ],
      "usd_mep",
      "mep",
    );
    expect(saleCost(steps, "y")).toBe("25");
    expect(money(steps, "y")).toMatchObject({ cost: "75" });
  });

  it("sells the same units in a unit where the units left with no cost", () => {
    // In pesos x's purchases have no rate, so its cost is unknown there; the
    // cost set by hand still comes in, and y sells the units x had first.
    const all = [
      ...X,
      bought("y", "10", "50", "2026-02-15"),
      ...moved("5", "2026-03-02", "400"),
      sold("y", "5", "2026-03-05"),
    ].map((m) =>
      m.holding_id === "x" && m.kind === "purchase"
        ? ({ ...m, rates: {} } as unknown as Movement)
        : m,
    );
    expect(saleCost(replayHoldings(all, "usd_mep", "mep"), "y")).toBe("2000");
    // 400 dollars a unit at the transfer's MEP of 1200.
    expect(saleCost(replayHoldings(all, "ars", "mep"), "y")).toBe("2400000");
  });

  it("brings no cost from a holding whose cost went unknown", () => {
    // x's first lot was costed before its second purchase lost it in pesos;
    // all 10 of it move.
    const steps = replayHoldings(
      [...X, ...moved("10", "2026-03-02")].map((m) =>
        m.holding_id === "x" && m.date === "2026-02-02"
          ? ({ ...m, rates: {} } as unknown as Movement)
          : m,
      ),
      "ars",
      "mep",
    );
    expect(money(steps, "y")).toBeNull();
  });

  it("sells the part of a lot it kept before the part that came back", () => {
    // 4 of the 10 at 100 go to y at 30 each and come back: x holds 6 costing
    // 600, then those 4 costing 120.
    const back = [
      transfer("out", "4", { holding: "y", op: "back", date: "2026-03-09" }),
      transfer("in", "4", { holding: "x", op: "back", date: "2026-03-09" }),
    ];
    const steps = replayHoldings(
      [
        bought("x", "10", "100", "2026-01-05"),
        ...moved("4", "2026-03-02", "30"),
        ...back,
        sold("x", "6", "2026-03-12"),
      ],
      "usd_mep",
      "mep",
    );
    expect(saleCost(steps, "x")).toBe("600");
  });

  it("places each lot it brought among the ones held by when it was bought", () => {
    // x: 10 at 100 (01-05) and 10 at 200 (02-02); y: 10 at 50 (01-10) and
    // 10 at 20 (02-10). The 15 moved are the 10 at 100 and 5 at 200.
    const steps = replayHoldings(
      [
        ...X,
        bought("y", "10", "50", "2026-01-10"),
        bought("y", "10", "20", "2026-02-10"),
        ...moved("15", "2026-03-02"),
        sold("y", "15", "2026-03-05"),
        sold("y", "20", "2026-03-06"),
      ],
      "usd_mep",
      "mep",
    );
    const costs = steps
      .get("y")!
      .flatMap((step) => (step.sale ? [step.sale.cost] : []));
    // 10 at 100 and 5 at 50; then 5 at 50, 5 at 200 and 10 at 20.
    expect(costs).toEqual(["1250", "1450"]);
  });

  it("sells the units that came back first once the lot they left is gone", () => {
    // x's 10 at 100 all go to y and 5 of them come back, ahead of the 10 at
    // 200 x still holds.
    const back = [
      transfer("out", "5", { holding: "y", op: "back", date: "2026-03-09" }),
      transfer("in", "5", { holding: "x", op: "back", date: "2026-03-09" }),
    ];
    const steps = replayHoldings(
      [
        ...X,
        ...moved("10", "2026-03-02"),
        ...back,
        sold("x", "5", "2026-03-12"),
      ],
      "usd_mep",
      "mep",
    );
    expect(saleCost(steps, "x")).toBe("500");
  });
});

describe("a replay admission would refuse", () => {
  it("names a sale its lots cannot cover as oversold", () => {
    // Legs of unequal size: y holds 5 by quantity but only 2 units of lots.
    const uneven = [
      transfer("out", "2", { holding: "x", op: "u", date: "2026-03-02" }),
      transfer("in", "5", { holding: "y", op: "u", date: "2026-03-02" }),
    ];
    expect(() =>
      replayHoldings(
        [
          ...X,
          ...uneven,
          inHolding("y", trade("sale", "5", "500", { date: "2026-03-05" })),
        ],
        "usd_mep",
        "mep",
      ),
    ).toThrow(new PositionError("oversold"));
  });
});

describe("compareInReplay", () => {
  it("puts a transfer's leaving side first whatever its id", () => {
    const [out, arrive] = moved("1", "2026-03-02");
    const late = { ...out!, id: "zzz" };
    const early = { ...arrive!, id: "aaa" };
    expect([early, late].sort(compareInReplay).map((m) => m.id)).toEqual([
      "zzz",
      "aaa",
    ]);
  });

  it("knows no cost for units arriving alone in a single holding's replay", () => {
    const [, arrive] = moved("5", "2026-03-02");
    expect(positionOf(replay([arrive!], "usd_mep", "mep")).money).toBeNull();
  });

  it("takes the cost set by hand for units arriving alone", () => {
    const [, arrive] = moved("5", "2026-03-02", "400");
    expect(positionOf(replay([arrive!], "usd_mep", "mep")).money).toMatchObject(
      { cost: "2000" },
    );
  });

  it("opens the lot of units arriving alone where they arrive", () => {
    // 1 at 10, 1 at 20, then 1 arriving alone at 30: a sale of 2 takes the
    // two purchases.
    const [, arrive] = moved("1", "2026-03-02", "30");
    const steps = replay(
      [
        trade("purchase", "1", "10", { date: "2026-01-05" }),
        trade("purchase", "1", "20", { date: "2026-02-02" }),
        arrive!,
        trade("sale", "2", "500", { date: "2026-03-05" }),
      ],
      "usd_mep",
      "mep",
    );
    expect(steps.at(-1)!.sale!.cost).toBe("30");
  });

  it("carries the cost when the arriving side's id sorts first", () => {
    const [out, arrive] = moved("5", "2026-03-02");
    const steps = replayHoldings(
      [...X, { ...arrive!, id: "aaa" }, { ...out!, id: "zzz" }],
      "usd_mep",
      "mep",
    );
    expect(money(steps, "y")).toMatchObject({ cost: "500" });
  });
});

describe("transfer cash flows", () => {
  it("moves no money and leaves the next flow its own cost", () => {
    const own = [
      bought("x", "10", "100", "2026-01-05"),
      transfer("out", "5", { holding: "x", op: "t", date: "2026-02-01" }),
      bought("x", "10", "100", "2026-02-02"),
    ];
    const flows = cashFlowsOf(own, replay(own, "usd_mep", "mep"))!;
    expect(flows.map((flow) => flow.amount)).toEqual(["-1000", "0", "-1000"]);
  });
});

describe("a transfer's fee", () => {
  const out = transfer("out", "5", {
    holding: "x",
    op: "t",
    date: "2026-03-02",
    fees: "7",
  });
  const arrive = transfer("in", "5", {
    holding: "y",
    op: "t",
    date: "2026-03-02",
  });
  const all = [...X, out, arrive];

  it("leaves the units' cost as it was and realizes nothing", () => {
    const steps = replayHoldings(all, "usd_mep", "mep");
    expect(money(steps, "x")).toEqual({
      cost: "2500",
      charges: "7",
      income: "0",
      realized: "0",
    });
    expect(money(steps, "y")).toEqual({
      cost: "500",
      charges: "0",
      income: "0",
      realized: "0",
    });
  });

  it("is an expense of the transfer's month, paid out of no sale", () => {
    const steps = replayHoldings(all, "usd_mep", "mep");
    const flowsOf = (holding: string) =>
      cashFlowsOf(
        all.filter((movement) => movement.holding_id === holding),
        steps.get(holding)!,
      )!;
    const march = [...flowsOf("x"), ...flowsOf("y")].filter(
      (flow) => flow.date > "2026-02-28",
    );
    expect(march).toEqual([
      { date: "2026-03-02", amount: "-7", kind: "sell", charges: "7" },
      { date: "2026-03-02", amount: "0", kind: "buy", charges: "0" },
    ]);
    // Prices did not move: the month's result is the fee, lost.
    expect(
      periodResult({
        from: "2026-02-28",
        to: "2026-03-31",
        startValue: "4000",
        endValue: "4000",
        flows: march,
      }),
    ).toMatchObject({
      paidIn: "0",
      proceeds: "0",
      contributed: "0",
      market: "0",
      charges: "7",
      result: "-7",
    });
  });
});
