import {
  DENOMINATORS,
  type Denominator,
  positionOf,
  priceSource,
  quotesNeeded,
  readSnapshot,
} from "@plant/core";
import {
  addDays,
  compareDecimals,
  exactOf,
  plus,
  stored,
  times,
  toDecimal,
  ZERO,
} from "@plant/shared";

import { instrumentSummary } from "@/lib/holdings/instrument-history";
import { buildFixtures } from "@/lib/prototype/fixtures";
import { createFixtureQuoteReader } from "@/lib/prototype/quote-reader";

import {
  allRows,
  initialState,
  instrumentHoldings,
  operationOf,
  positionsOf,
  pricedSnapshotOf,
  type PrototypeState,
  stepsOf,
  writeOperation,
} from "./prototype-store";

const TODAY = "2026-10-12";
const fixtures = buildFixtures(TODAY);
const state = initialState(fixtures, TODAY);
const UNITS = Object.keys(DENOMINATORS) as Denominator[];
const MANUALLY_PRICED = ["GD30", "FIMAAHO", "TX26"] as const;

const holdingOfSymbol = (s: PrototypeState, symbol: string) =>
  s.holdings.find(
    (each) =>
      each.holding.asset_class === "instrument" &&
      each.holding.instrument_symbol === symbol,
  )!;

describe("the holdings priced by hand replay first in, first out", () => {
  it.each(
    MANUALLY_PRICED.flatMap((symbol) => UNITS.map((unit) => [symbol, unit])),
  )("%s in %s never goes below zero and ends at its amount", (symbol, unit) => {
    const held = holdingOfSymbol(state, symbol);
    const steps = stepsOf(state, held.holding.id, unit as Denominator);
    expect(steps.length).toBeGreaterThan(0);
    for (const step of steps) {
      expect(compareDecimals(step.position.quantity, "0")).toBeGreaterThan(0);
      const money = step.position.money;
      if (money === null) continue;
      expect(compareDecimals(money.cost, "0")).toBeGreaterThanOrEqual(0);
      expect(compareDecimals(money.charges, "0")).toBeGreaterThanOrEqual(0);
    }
    expect(held.closed).toBe(false);
    expect(
      compareDecimals(positionOf(steps).quantity, held.holding.amount),
    ).toBe(0);
    expect(
      positionsOf(state, unit as Denominator).get(held.holding.id),
    ).toEqual(positionOf(steps));
  });

  // Each one only buys, so its cost in its own currency's unit is what every
  // purchase paid, quantity times price, before charges.
  it.each([
    ["GD30", "usd_mep"],
    ["FIMAAHO", "ars"],
    ["TX26", "ars"],
  ] as const)("costs %s in %s at what every purchase paid", (symbol, unit) => {
    const id = holdingOfSymbol(state, symbol).holding.id;
    const paid = plus(
      ZERO,
      ...state.movements
        .get(id)!
        .map((movement) =>
          "quantity" in movement && movement.price !== null
            ? times(exactOf(movement.quantity), exactOf(movement.price))
            : ZERO,
        ),
    );
    const money = positionOf(stepsOf(state, id, unit)).money;
    expect(money).not.toBeNull();
    expect(compareDecimals(money!.cost, stored(paid))).toBe(0);
    expect(money!.realized).toBe("0");
  });
});

describe("an edit that moves an imported purchase in time", () => {
  const BALANZ = state.accounts.find((row) => row.institution === "Balanz")!.id;
  // Balanz holds GD30 only in Largo plazo; Principal has none.
  const PRINCIPAL = fixtures.portfolios[0]!.id;
  const [D0, D1, D2, D3] = [10, 8, 6, 4].map((days) =>
    addDays(TODAY, -days),
  ) as [string, string, string, string];
  const gd30 = (
    kind: "purchase" | "sale",
    date: string,
    quantity: string,
    price: string,
  ) => ({
    kind,
    source_connection_id: BALANZ,
    instrument_symbol: "GD30",
    date,
    currency: "USD",
    price,
    charges: [],
    reference: null,
    note: null,
    parts: [{ portfolio_id: PRINCIPAL, quantity }],
  });
  const imported = {
    kind: "import" as const,
    fileName: "balanz.pdf",
    date: TODAY,
  };
  const [I, M, S] = [1, 2, 3].map(
    (n) => `e8000000-0000-4000-8000-00000000000${n}`,
  ) as [string, string, string];
  let ids = 0;
  const newId = () =>
    `e8100000-0000-4000-8000-${String((ids += 1)).padStart(12, "0")}`;
  const principal = (s: PrototypeState) =>
    s.holdings.find(
      (each) =>
        each.portfolioId === PRINCIPAL &&
        each.holding.asset_class === "instrument" &&
        each.holding.instrument_symbol === "GD30",
    )!;
  const ok = (written: ReturnType<typeof writeOperation>, id: string) => {
    expect(written.result).toEqual({ ok: true, id });
    return written.state;
  };

  // Imported 100 at 0.50 on D2, typed 100 at 0.70 on D1, sold 100 on D3: the
  // sale takes the typed lot, the oldest.
  const before = (() => {
    let s = ok(
      writeOperation(state, gd30("purchase", D2, "100", "0.5"), {
        operationId: I,
        newId,
        origin: imported,
      }),
      I,
    );
    s = ok(
      writeOperation(s, gd30("purchase", D1, "100", "0.7"), {
        operationId: M,
        newId,
      }),
      M,
    );
    return ok(
      writeOperation(s, gd30("sale", D3, "100", "0.8"), {
        operationId: S,
        newId,
      }),
      S,
    );
  })();
  const saleOf = (s: PrototypeState) => {
    const steps = stepsOf(s, principal(s).holding.id, "usd_mep");
    const movement = operationOf(s, S)!.parts[0]!.movement;
    return steps.find((step) => step.id === movement.id)!.sale!;
  };

  it("sells the oldest lot before the edit", () => {
    expect(compareDecimals(saleOf(before).cost, "70")).toBe(0);
    const position = positionsOf(before, "usd_mep").get(
      principal(before).holding.id,
    )!;
    expect(position.quantity).toBe("100");
    expect(compareDecimals(position.money!.cost, "50")).toBe(0);
  });

  it("sells the imported lot once the edit makes it the oldest, keeping where it came from", () => {
    const moved = ok(
      writeOperation(before, gd30("purchase", D0, "100", "0.5"), {
        operationId: I,
        replacing: true,
        newId,
      }),
      I,
    );
    expect(operationOf(moved, I)!.parts[0]!.movement.date).toBe(D0);
    expect(compareDecimals(saleOf(moved).cost, "50")).toBe(0);
    expect(compareDecimals(saleOf(moved).result, "30")).toBe(0);
    const position = positionsOf(moved, "usd_mep").get(
      principal(moved).holding.id,
    )!;
    expect(position.quantity).toBe("100");
    expect(compareDecimals(position.money!.cost, "70")).toBe(0);
    expect(principal(moved).origin).toEqual(imported);
    expect(moved.operationOrigins.get(I)).toEqual(imported);
    expect(moved.operationOrigins.has(M)).toBe(false);
    expect(moved.operationOrigins.has(S)).toBe(false);
  });

  it("keeps every unit costed at zero or more in every unit after the edit", () => {
    const moved = ok(
      writeOperation(before, gd30("purchase", D0, "100", "0.5"), {
        operationId: I,
        replacing: true,
        newId,
      }),
      I,
    );
    for (const unit of UNITS) {
      for (const step of stepsOf(moved, principal(moved).holding.id, unit)) {
        expect(
          compareDecimals(step.position.quantity, "0"),
        ).toBeGreaterThanOrEqual(0);
        if (step.position.money) {
          expect(
            compareDecimals(step.position.money.cost, "0"),
          ).toBeGreaterThanOrEqual(0);
        }
      }
    }
    expect(principal(moved).holding.amount).toBe("100");
  });
});

describe("GD30's instrument page", () => {
  const snapshotOf = async () =>
    (
      await readSnapshot(
        createFixtureQuoteReader(fixtures.quotes),
        TODAY,
        quotesNeeded(fixtures.holdings.map((row) => row.holding)),
      )
    ).snapshot;
  const latestManual = (symbol: string) =>
    fixtures.manualPrices
      .filter((row) => row.symbol === symbol)
      .sort((a, b) => b.price_date.localeCompare(a.price_date))[0]!.price;
  const amountOf = (symbol: string) =>
    allRows(state).find(
      (row) =>
        row.holding.asset_class === "instrument" &&
        row.holding.instrument_symbol === symbol,
    )!.holding.amount;

  it("values its summary at the latest manual price", async () => {
    const priced = pricedSnapshotOf(state, await snapshotOf());
    expect(priceSource("GD30", priced)).toBe("manual");
    const { holdings, flows, value } = instrumentHoldings(
      state,
      "GD30",
      "usd_mep",
      priced.snapshot,
    );
    const expected = toDecimal(
      times(exactOf(amountOf("GD30")), exactOf(latestManual("GD30"))),
      2,
    );
    expect(value).toBe(expected);
    const summary = instrumentSummary(holdings, flows, state.today, value);
    expect(summary.value).toBe(expected);
    expect(summary.quantity).toBe(amountOf("GD30"));
    expect(summary.cost).not.toBeNull();
    expect(summary.unrealized).not.toBeNull();
    expect(summary.returns).not.toBeNull();
  });

  it("has no value without the manual prices", async () => {
    const { holdings, flows, value } = instrumentHoldings(
      state,
      "GD30",
      "usd_mep",
      await snapshotOf(),
    );
    expect(value).toBeNull();
    const summary = instrumentSummary(holdings, flows, state.today, value);
    expect(summary.unrealized).toBeNull();
    expect(summary.cost).not.toBeNull();
  });

  it("values it in pesos too, and leaves TX26 with none", async () => {
    const priced = pricedSnapshotOf(state, await snapshotOf()).snapshot;
    expect(instrumentHoldings(state, "GD30", "ars", priced).value).not.toBe(
      null,
    );
    const tx26 = instrumentHoldings(state, "TX26", "ars", priced);
    expect(tx26.value).toBeNull();
    expect(
      instrumentSummary(tx26.holdings, tx26.flows, state.today, tx26.value)
        .unrealized,
    ).toBeNull();
  });
});
