import { buildFixtures } from "@/lib/prototype/fixtures";

import {
  closesOf,
  markRecalculated,
  monthDetail,
  yearsOfCloses,
} from "./prototype-closes";
import { deleteOperation, initialState } from "./prototype-store";

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
