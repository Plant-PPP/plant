import { buildFixtures } from "@/lib/prototype/fixtures";

import {
  closesOf,
  markRecalculated,
  monthDetail,
  yearsOfCloses,
} from "./prototype-closes";
import {
  deleteOperation,
  initialState,
  setPrice,
  writeOperation,
} from "./prototype-store";

const TODAY = "2026-10-12";
const state = initialState(buildFixtures(TODAY), TODAY);
const closes = closesOf(state, "usd_mep");

it("closes every month from the first movement, the last one open", () => {
  expect(closes.length).toBeGreaterThanOrEqual(23);
  expect(closes.at(-1)).toMatchObject({ period: "2026-10", open: true });
  expect(closes.slice(0, -1).every((each) => !each.open)).toBe(true);
});

it("starts each month where the last one ended", () => {
  for (let index = 1; index < closes.length; index += 1) {
    expect(closes[index]!.figures.startValue).toBe(
      closes[index - 1]!.figures.endValue,
    );
  }
});

it("sums a year's months and chains its return", () => {
  const [current] = yearsOfCloses(closes);
  expect(current!.year).toBe("2026");
  expect(current!.months).toHaveLength(10);
  expect(current!.totals.endValue).toBe(closes.at(-1)!.figures.endValue);
  expect(current!.totals.share).not.toBeNull();
});

it("lists a month's purchases, sales and income, newest first", () => {
  const september = monthDetail(state, "usd_mep", "2026-09")!;
  expect(september.lines.length).toBeGreaterThan(0);
  expect(
    september.lines.every((line) => line.movement.date.startsWith("2026-09")),
  ).toBe(true);
});

it("marks the closed months a deleted operation changes", () => {
  const sale = [...state.movements.values()]
    .flat()
    .find((each) => each.kind === "sale" && each.date < "2026-06-01")!;
  const { state: after } = deleteOperation(state, sale.operation_id);
  const marked = markRecalculated(state, after, "usd_mep");
  expect(marked.recalculated.get(sale.date.slice(0, 7))).toBe(TODAY);
  expect(marked.recalculated.has("2026-10")).toBe(false);
});

it("marks nothing for a write that moves no month's movements", () => {
  const priced = setPrice(state, {
    symbol: "KO",
    price_date: "2026-01-15",
    price: "9000",
    currency: "ARS",
  }).state;
  expect(markRecalculated(state, priced, "usd_mep").recalculated.size).toBe(0);
});

it("counts a holding with no movements in every month's net worth", () => {
  const cash = state.holdings.find(
    (each) => each.holding.asset_class === "cash",
  )!;
  const without = {
    ...state,
    holdings: state.holdings.filter((each) => each !== cash),
  };
  const [first] = closesOf(state, "ars");
  const [firstWithout] = closesOf(without, "ars");
  expect(first!.figures.endValue).not.toBe(firstWithout!.figures.endValue);
});

it("marks a closed month whose units changed at no cost", () => {
  const iol = state.accounts.find((each) => each.institution === "IOL")!;
  const after = writeOperation(
    state,
    {
      kind: "adjustment",
      direction: "in",
      source_connection_id: iol.id,
      instrument_symbol: "AAPL",
      date: "2026-03-16",
      currency: "ARS",
      price: "0",
      charges: [],
      reference: null,
      note: null,
      parts: [{ portfolio_id: iol.portfolio.id, quantity: "5" }],
    },
    { operationId: "split", newId: () => crypto.randomUUID() },
  );
  expect(after.result.ok).toBe(true);
  const marked = markRecalculated(state, after.state, "usd_mep");
  expect(marked.recalculated.get("2026-03")).toBe(TODAY);
});

it("keeps charges out of the market result", () => {
  for (const close of closes) {
    const { market, income, charges, result } = close.figures;
    expect(Number(result)).toBeCloseTo(
      Number(market) + Number(income) - Number(charges),
      6,
    );
  }
  expect(closes.some((each) => Number(each.figures.charges) > 0)).toBe(true);
});

it("counts an opening balance at its worth that day, not as a gain", () => {
  const iol = state.accounts.find((each) => each.institution === "IOL")!;
  const quote = state.quotes.prices.find(
    (each) => each.symbol === "NVDA" && each.price_date === "2026-09-15",
  )!;
  const opened = writeOperation(
    state,
    {
      kind: "opening_balance",
      source_connection_id: iol.id,
      instrument_symbol: "NVDA",
      date: "2026-09-15",
      currency: "ARS",
      // Its cost, far under what it was worth that day.
      price: "1",
      charges: [],
      reference: null,
      note: null,
      parts: [{ portfolio_id: iol.portfolio.id, quantity: "100" }],
    },
    { operationId: "opening", newId: () => crypto.randomUUID() },
  );
  expect(opened.result.ok).toBe(true);
  const month = (each: typeof state) =>
    closesOf(each, "ars").find((close) => close.period === "2026-09")!;
  const before = month(state).figures;
  const after = month(opened.state).figures;
  // What came in is the holding's worth at that day's quote, and the market
  // result moves only with its price after that day.
  expect(Number(after.paidIn) - Number(before.paidIn)).toBeCloseTo(
    100 * Number(quote.price),
    2,
  );
  expect(Math.abs(Number(after.market) - Number(before.market))).toBeLessThan(
    100 * Number(quote.price) * 0.5,
  );
});

it("marks a month whose adjustment out an earlier write repriced", () => {
  const iol = state.accounts.find((each) => each.institution === "IOL")!;
  const input = (
    date: string,
    kind: "purchase" | "adjustment",
    price: string,
  ) => ({
    kind,
    ...(kind === "adjustment" && { direction: "out" as const }),
    source_connection_id: iol.id,
    instrument_symbol: "MSFT",
    date,
    currency: "ARS",
    price,
    charges: [],
    reference: null,
    note: null,
    parts: [
      {
        portfolio_id: iol.portfolio.id,
        quantity: kind === "purchase" ? "10" : "5",
      },
    ],
  });
  let id = 0;
  const newId = () =>
    `f0000000-0000-4000-8000-${String((id += 1)).padStart(12, "0")}`;
  const bought = writeOperation(state, input("2026-03-02", "purchase", "100"), {
    operationId: "buy",
    newId,
  }).state;
  const out = writeOperation(bought, input("2026-05-04", "adjustment", "0"), {
    operationId: "out",
    newId,
  }).state;
  const repriced = writeOperation(out, input("2026-03-02", "purchase", "200"), {
    operationId: "buy",
    replacing: true,
    newId,
  }).state;
  const marked = markRecalculated(out, repriced, "ars");
  expect(marked.recalculated.get("2026-03")).toBe(TODAY);
  expect(marked.recalculated.get("2026-05")).toBe(TODAY);
});

it("marks the months after an earlier purchase whose units it held", () => {
  const meli = [...state.movements.values()]
    .flat()
    .find(
      (each) =>
        each.kind === "purchase" &&
        each.date === "2025-09-27" &&
        state.holdings.some(
          (held) =>
            held.holding.id === each.holding_id &&
            held.holding.asset_class === "instrument" &&
            held.holding.instrument_symbol === "MELI",
        ),
    )!;
  const after = deleteOperation(state, meli.operation_id);
  expect(after.result.ok).toBe(true);
  const marked = markRecalculated(state, after.state, "usd_mep");
  expect(marked.recalculated.get("2025-09")).toBe(TODAY);
  expect(marked.recalculated.get("2025-12")).toBe(TODAY);
});

it("marks nothing when a purchase's units move between portfolios", () => {
  const iol = state.accounts.find((each) => each.institution === "IOL")!;
  const [principal, largo] = state.portfolios;
  const purchase = (parts: { portfolio_id: string; quantity: string }[]) => ({
    kind: "purchase" as const,
    source_connection_id: iol.id,
    instrument_symbol: "AAPL",
    date: "2026-06-15",
    currency: "ARS",
    price: "33333.33",
    charges: [{ kind: "commission", label: null, amount: "7.77" }],
    reference: null,
    note: null,
    parts,
  });
  const newId = () => crypto.randomUUID();
  const split = writeOperation(
    state,
    purchase([
      { portfolio_id: principal!.id, quantity: "1" },
      { portfolio_id: largo!.id, quantity: "2" },
    ]),
    { operationId: "moved", newId },
  ).state;
  const whole = writeOperation(
    split,
    purchase([{ portfolio_id: principal!.id, quantity: "3" }]),
    { operationId: "moved", replacing: true, newId },
  ).state;
  expect(markRecalculated(split, whole, "usd_mep").recalculated.size).toBe(0);
});
