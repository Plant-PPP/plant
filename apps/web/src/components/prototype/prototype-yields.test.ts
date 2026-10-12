import { quantityOn, type Trade } from "@plant/core";
import { exactOf, minus, stored } from "@plant/shared";

import { lineLabel, MOVEMENT_MESSAGES } from "@/lib/holdings/messages";
import { buildFixtures } from "@/lib/prototype/fixtures";

import { closesOf, markRecalculated } from "./prototype-closes";
import {
  deleteOperation,
  holdingIn,
  initialState,
  movementsPage,
  priceOn,
  type PrototypeState,
  stepsOf,
  writeOperation,
} from "./prototype-store";

const TODAY = "2026-10-12";
const fixtures = buildFixtures(TODAY);
const state = initialState(fixtures, TODAY);

const IOL = fixtures.accounts.find((row) => row.institution === "IOL")!.id;
const [PRINCIPAL, LARGO] = fixtures.portfolios.map((row) => row.id) as [
  string,
  string,
];
const DAY = "2026-09-30";
const YIELD = "e5000000-0000-4000-8000-000000000001";
let ids = 0;
const options = (operationId = YIELD, replacing = false) => ({
  operationId,
  replacing,
  newId: () =>
    `e6000000-0000-4000-8000-${String((ids += 1)).padStart(12, "0")}`,
});

const appleIn = (s: PrototypeState, portfolio = PRINCIPAL) =>
  holdingIn(s, IOL, "AAPL", portfolio);
const movementsOf = (s: PrototypeState, portfolio = PRINCIPAL) =>
  s.movements.get(appleIn(s, portfolio)!.holding.id)!;
const positionOf = (s: PrototypeState, portfolio = PRINCIPAL) =>
  stepsOf(s, appleIn(s, portfolio)!.holding.id, "ars").at(-1)!.position;
const heldOn = (s: PrototypeState, date = DAY) =>
  quantityOn(movementsOf(s), date);

// Apple in IOL's Principal earned or lost units, or now holds a balance.
const yielded = (
  part: { direction: "in" | "out"; quantity: string } | { balance: string },
  {
    portfolio = PRINCIPAL,
    date = DAY,
    price = "20000",
  }: { portfolio?: string; date?: string; price?: string } = {},
) => ({
  kind: "yield",
  source_connection_id: IOL,
  instrument_symbol: "AAPL",
  date,
  currency: "ARS",
  price,
  reference: null,
  note: null,
  parts: [{ portfolio_id: portfolio, ...part }],
});

const written = (input: unknown, from = state, replacing = false) => {
  const write = writeOperation(from, input, options(YIELD, replacing));
  expect(write.result).toEqual({ ok: true, id: YIELD });
  return write.state;
};
const refusal = (input: unknown, from = state) => {
  const write = writeOperation(from, input, options());
  expect(write.state).toBe(from);
  return write.result;
};

describe("the quote of a day", () => {
  it("is the feed's price on that day", () => {
    const feed = state.quotes.prices.find(
      (each) => each.symbol === "AAPL" && each.price_date === DAY,
    )!;
    expect(priceOn(state, { symbol: "AAPL", currency: "ARS", date: DAY })).toBe(
      feed.price,
    );
  });

  it("is the latest manual price on or before it without a feed", () => {
    expect(
      priceOn(state, { symbol: "KO", currency: "ARS", date: "2026-09-10" }),
    ).toBe("6458.27");
    expect(
      priceOn(state, { symbol: "KO", currency: "ARS", date: "2026-07-01" }),
    ).toBeNull();
  });

  it("is none in another currency or for an instrument nobody quotes", () => {
    expect(
      priceOn(state, { symbol: "AAPL", currency: "USD", date: DAY }),
    ).toBeNull();
    expect(
      priceOn(state, { symbol: "AL30", currency: "ARS", date: DAY }),
    ).toBeNull();
  });
});

describe("the units held at the end of a day", () => {
  it("count that day's purchases and sales", () => {
    // 4 bought and 20 sold on the 7th.
    const before = heldOn(state, "2025-09-06");
    expect(heldOn(state, "2025-09-07")).toBe(
      stored(minus(exactOf(before), exactOf("16"))),
    );
  });
});

describe("a yield", () => {
  const earned = written(yielded({ direction: "in", quantity: "2" }));

  it("adds its units, their value as cost and as income", () => {
    const before = positionOf(state);
    const after = positionOf(earned);
    expect(after.quantity).toBe(
      stored(minus(exactOf(before.quantity), exactOf("-2"))),
    );
    for (const field of ["cost", "income"] as const) {
      expect(
        stored(
          minus(exactOf(after.money![field]), exactOf(before.money![field])),
        ),
      ).toBe("40000");
    }
  });

  it("lists its value as the amount, as Rendimiento", () => {
    const page = movementsPage(
      earned,
      { holdingId: appleIn(earned)!.holding.id },
      "ars",
      null,
    );
    if (!page.ok) throw new Error("page failed");
    const line = page.rows.find((row) => row.movement.operation_id === YIELD)!;
    expect(line).toMatchObject({ amount: "40000", charges: "0" });
    expect(lineLabel(line)).toBe("Rendimiento");
  });

  it("lists a loss as Rendimiento negativo, its value negative", () => {
    const lost = written(yielded({ direction: "out", quantity: "2" }));
    const page = movementsPage(
      lost,
      { holdingId: appleIn(lost)!.holding.id },
      "ars",
      null,
    );
    if (!page.ok) throw new Error("page failed");
    const line = page.rows.find((row) => row.movement.operation_id === YIELD)!;
    expect(line.amount).toBe("-40000");
    expect(lineLabel(line)).toBe("Rendimiento negativo");
  });

  it("refuses losing more units than were held", () => {
    const more = stored(minus(exactOf(heldOn(state)), exactOf("-1")));
    expect(refusal(yielded({ direction: "out", quantity: more }))).toEqual({
      ok: false,
      code: "oversold",
    });
  });

  it("refuses a holding that does not exist", () => {
    expect(
      refusal(
        yielded({ direction: "in", quantity: "1" }, { portfolio: LARGO }),
      ),
    ).toEqual({ ok: false, code: "not_found" });
  });

  it("refuses more than one portfolio", () => {
    const input = yielded({ direction: "in", quantity: "1" });
    expect(
      refusal({
        ...input,
        parts: [
          ...input.parts,
          { portfolio_id: LARGO, direction: "in", quantity: "1" },
        ],
      }),
    ).toEqual({ ok: false, code: "invalid" });
  });

  it("refuses charges and a missing value", () => {
    const input = yielded({ direction: "in", quantity: "1" });
    expect(
      refusal({
        ...input,
        charges: [{ kind: "tax", label: null, amount: "1" }],
      }),
    ).toEqual({ ok: false, code: "invalid" });
    expect(refusal({ ...input, price: undefined })).toEqual({
      ok: false,
      code: "invalid",
    });
  });

  it("reopens a holding sold to zero", () => {
    const sold = written(
      {
        kind: "sale",
        source_connection_id: IOL,
        instrument_symbol: "AAPL",
        date: "2026-10-01",
        currency: "ARS",
        price: "20000",
        parts: [{ portfolio_id: PRINCIPAL, quantity: heldOn(state, TODAY) }],
      },
      state,
    );
    expect(appleIn(sold)!.closed).toBe(true);
    const reopened = writeOperation(
      sold,
      yielded({ direction: "in", quantity: "1" }, { date: TODAY }),
      options("e5000000-0000-4000-8000-000000000002"),
    );
    expect(reopened.result.ok).toBe(true);
    expect(appleIn(reopened.state)!.closed).toBe(false);
    expect(positionOf(reopened.state).quantity).toBe("1");
  });

  it("never starts a holding, even once what came before it is deleted", () => {
    const bought = writeOperation(
      state,
      {
        kind: "purchase",
        source_connection_id: IOL,
        instrument_symbol: "AAPL",
        date: "2026-09-01",
        currency: "ARS",
        price: "18000",
        parts: [{ portfolio_id: LARGO, quantity: "3" }],
      },
      options("e5000000-0000-4000-8000-000000000003"),
    ).state;
    const earning = written(
      yielded({ direction: "in", quantity: "1" }, { portfolio: LARGO }),
      bought,
    );
    const removed = deleteOperation(
      earning,
      "e5000000-0000-4000-8000-000000000003",
    );
    expect(removed.result).toEqual({ ok: false, code: "opening_balance" });
    expect(removed.state).toBe(earning);
  });
});

describe("a yield given as the balance at the end of its day", () => {
  const held = heldOn(state);
  const plusUnits = (units: string) =>
    stored(minus(exactOf(held), exactOf(`-${units}`)));

  it("records what came in above what was held", () => {
    const after = written(yielded({ balance: plusUnits("3") }));
    expect(movementsOf(after).at(-1)).toMatchObject({
      kind: "yield",
      direction: "in",
      quantity: "3",
    });
  });

  it("records what went out below what was held", () => {
    const after = written(
      yielded({ balance: stored(minus(exactOf(held), exactOf("2.5"))) }),
    );
    expect(movementsOf(after).at(-1)).toMatchObject({
      direction: "out",
      quantity: "2.5",
    });
  });

  it("refuses the balance already held", () => {
    expect(refusal(yielded({ balance: held }))).toEqual({
      ok: false,
      code: "same_balance",
    });
    expect(MOVEMENT_MESSAGES.same_balance).toBe(
      "Es el saldo que ya tenías ese día: no hay rendimiento para cargar.",
    );
  });

  it("counts from what was held without the yield it edits", () => {
    const first = written(yielded({ balance: plusUnits("2") }));
    const edited = written(yielded({ balance: plusUnits("5") }), first, true);
    const own = movementsOf(edited).filter(
      (each) => each.operation_id === YIELD,
    );
    expect(own).toEqual([
      expect.objectContaining({ direction: "in", quantity: "5" }),
    ]);
  });
});

describe("a balance and the day it is for", () => {
  const purchase = (date: string, quantity: string, kind = "purchase") => ({
    kind,
    source_connection_id: IOL,
    instrument_symbol: "AAPL",
    date,
    currency: "ARS",
    price: "20000",
    parts: [{ portfolio_id: PRINCIPAL, quantity }],
  });

  it("counts what was held at the end of its own day, not today", () => {
    const sold = writeOperation(
      state,
      purchase("2026-10-05", "1", "sale"),
      options("e5000000-0000-4000-8000-00000000000a"),
    ).state;
    const balance = stored(minus(exactOf(heldOn(sold)), exactOf("-3")));
    const after = written(yielded({ balance }), sold);
    expect(
      movementsOf(after).find((each) => each.operation_id === YIELD),
    ).toMatchObject({ direction: "in", quantity: "3" });
  });

  it("ends the day at the balance when edited before a later purchase that day", () => {
    const first = written(yielded({ direction: "in", quantity: "1" }));
    const bought = writeOperation(
      first,
      purchase(DAY, "5"),
      options("e5000000-0000-4000-8000-000000000009"),
    ).state;
    // Fewer than the 5 bought after it: kept before the purchase, the loss
    // would take out more than was held then.
    const after = written(yielded({ balance: "2" }), bought, true);
    expect(heldOn(after)).toBe("2");
  });

  it("marks the month a yield's edit changes as recalculated", () => {
    const first = written(yielded({ direction: "in", quantity: "1" }));
    const edited = markRecalculated(
      first,
      written(
        yielded({ direction: "in", quantity: "1" }, { price: "21000" }),
        first,
        true,
      ),
    );
    expect(edited.recalculated.get("2026-09")).toBe(TODAY);
  });
});

describe("a month with a yield", () => {
  const price = priceOn(state, { symbol: "AAPL", currency: "ARS", date: DAY })!;
  const september = (s: PrototypeState) =>
    closesOf(s, "ars").find((close) => close.period === "2026-09")!;
  const change = (
    after: PrototypeState,
    field: "income" | "market" | "realized" | "contributed",
  ) => {
    const was = september(state);
    const now = september(after);
    const of = (close: typeof was) =>
      field === "realized" ? close.realized : close.figures[field];
    return Number(of(now)) - Number(of(was));
  };

  it("counts its value as income, not as a market move or money put in", () => {
    const after = written(
      yielded({ direction: "in", quantity: "2" }, { price }),
    );
    expect(change(after, "income")).toBeCloseTo(2 * Number(price), 2);
    expect(change(after, "market")).toBeCloseTo(0, 2);
    expect(change(after, "contributed")).toBeCloseTo(0, 2);
  });

  it("realizes what the units a loss took out had gained", () => {
    const after = written(
      yielded({ direction: "out", quantity: "2" }, { price }),
    );
    const before = positionOf(state);
    const gained =
      2 * Number(price) -
      (2 * Number(before.money!.cost)) / Number(before.quantity);
    expect(change(after, "realized")).toBeCloseTo(gained, 1);
    expect(change(after, "income")).toBeCloseTo(-2 * Number(price), 2);
  });
});

it("prices a day nothing quotes at a yield's value, as it would a trade's", () => {
  const ko = state.holdings.find(
    (each) =>
      each.holding.asset_class === "instrument" &&
      each.holding.instrument_symbol === "KO",
  )!;
  const own = state.movements.get(ko.holding.id)!;
  const june = "2026-06-30";
  const traded = own.filter(
    (each): each is Trade =>
      (each.kind === "purchase" || each.kind === "sale") && each.date <= june,
  );
  const old = Number(traded.at(-1)!.price);
  const value = (old * 1.1).toFixed(2);
  const held = Number(quantityOn(own, june));
  const after = writeOperation(
    state,
    {
      kind: "yield",
      source_connection_id: ko.accountId,
      instrument_symbol: "KO",
      date: june,
      currency: traded.at(-1)!.currency,
      price: value,
      reference: null,
      note: null,
      parts: [{ portfolio_id: ko.portfolioId, direction: "in", quantity: "1" }],
    },
    options("e5000000-0000-4000-8000-000000000004"),
  );
  expect(after.result.ok).toBe(true);
  const market = (s: PrototypeState) =>
    Number(
      closesOf(s, "ars").find((close) => close.period === "2026-06")!.figures
        .market,
    );
  // The units held move from the last trade's price to the yield's; the one
  // earned is income.
  expect(market(after.state) - market(state)).toBeCloseTo(
    held * (Number(value) - old),
    2,
  );
});
