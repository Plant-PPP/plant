import { cashFlowsOf } from "./returns";
import { ratesOf, trade, transfer } from "./fixtures.test-support";
import type { Movement } from "./movement";
import { compareInReplay } from "./order";
import { positionOf, replay, replayHoldings } from "./replay";

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
  it("moves units with their share of the cost and no result", () => {
    const steps = replayHoldings(
      [...X, ...moved("5", "2026-03-02")],
      "usd_mep",
      "mep",
    );
    expect(positionOf(steps.get("x")!).quantity).toBe("15");
    expect(money(steps, "x")).toMatchObject({ cost: "2250", realized: "0" });
    expect(positionOf(steps.get("y")!).quantity).toBe("5");
    expect(money(steps, "y")).toMatchObject({ cost: "750", realized: "0" });
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
    expect(money(steps, "x")).toMatchObject({ cost: "2250", realized: "0" });
  });

  it("follows an edit to the history the units left", () => {
    const edited = [
      bought("x", "10", "100", "2026-01-05"),
      bought("x", "10", "300", "2026-02-02"),
    ];
    const steps = replayHoldings(
      [...edited, ...moved("10", "2026-03-02")],
      "usd_mep",
      "mep",
    );
    expect(money(steps, "y")).toMatchObject({ cost: "2000" });
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
    expect(money(steps, "x")).toMatchObject({ cost: "2250" });
    expect(money(steps, "y")).toMatchObject({ cost: "750" });
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

  it("carries the cost when the arriving side's id sorts first", () => {
    const [out, arrive] = moved("5", "2026-03-02");
    const steps = replayHoldings(
      [...X, { ...arrive!, id: "aaa" }, { ...out!, id: "zzz" }],
      "usd_mep",
      "mep",
    );
    expect(money(steps, "y")).toMatchObject({ cost: "750" });
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
