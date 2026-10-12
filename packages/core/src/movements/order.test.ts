import { income, trade } from "./fixtures.test-support";
import { compareKeys, compareMovements, movementKey } from "./order";

it("orders a day as its operations were entered, an opening balance first", () => {
  const day = "2026-03-02";
  const sale = trade("sale", "1", "10", { id: "a", date: day, entry_order: 1 });
  const purchase = trade("purchase", "1", "10", {
    id: "b",
    date: day,
    entry_order: 2,
  });
  const dividend = income("dividend", "1", {
    id: "c",
    date: day,
    entry_order: 3,
  });
  const opening = trade("opening_balance", "1", "10", {
    id: "d",
    date: day,
    entry_order: 9,
  });
  const earlier = trade("sale", "1", "10", {
    id: "e",
    date: "2026-03-01",
    entry_order: 10,
  });
  expect(
    [dividend, purchase, sale, opening, earlier]
      .sort(compareMovements)
      .map((m) => m.id),
  ).toEqual(["e", "d", "a", "b", "c"]);
});

it("breaks a tie by id", () => {
  const a = trade("purchase", "1", "10", {
    id: "a",
    date: "2026-03-02",
    entry_order: 1,
  });
  const b = trade("purchase", "1", "10", {
    id: "b",
    date: "2026-03-02",
    entry_order: 1,
  });
  expect(compareMovements(a, b)).toBeLessThan(0);
  expect(compareMovements(a, a)).toBe(0);
});

it("orders cursors as it orders movements", () => {
  const movements = [
    trade("sale", "1", "10", { date: "2026-03-02" }),
    trade("purchase", "1", "10", { date: "2026-03-02" }),
    trade("opening_balance", "1", "10", { date: "2026-01-02" }),
  ];
  const byCursor = movements
    .map(movementKey)
    .sort((a, b) => compareKeys(b, a))
    .map((key) => key.id);
  const reversed = [...movements]
    .sort(compareMovements)
    .reverse()
    .map((m) => m.id);
  expect(byCursor).toEqual(reversed);
});

it("orders a day by entry order, not id", () => {
  const day = "2026-03-02";
  const late = trade("purchase", "1", "10", {
    id: "a",
    date: day,
    entry_order: 2,
  });
  const early = trade("sale", "1", "10", {
    id: "b",
    date: day,
    entry_order: 1,
  });
  expect([late, early].sort(compareMovements).map((m) => m.id)).toEqual([
    "b",
    "a",
  ]);
});

it("puts an opening balance before a movement entered first that day", () => {
  const day = "2026-03-02";
  const first = trade("purchase", "1", "10", {
    id: "a",
    date: day,
    entry_order: 0,
  });
  const opening = trade("opening_balance", "1", "10", {
    id: "b",
    date: day,
    entry_order: 5,
  });
  expect([first, opening].sort(compareMovements).map((m) => m.id)).toEqual([
    "b",
    "a",
  ]);
  expect(compareKeys(movementKey(opening), movementKey(first))).toBeLessThan(0);
});

it("orders every pair both ways, by date, then opening balance and entry order, then id", () => {
  const day = "2026-03-02";
  const ascending = [
    trade("purchase", "1", "10", {
      id: "z",
      date: "2026-03-01",
      entry_order: 9,
    }),
    trade("opening_balance", "1", "10", { id: "y", date: day, entry_order: 7 }),
    trade("purchase", "1", "10", { id: "x", date: day, entry_order: 0 }),
    trade("sale", "1", "10", { id: "a", date: day, entry_order: 1 }),
    trade("sale", "1", "10", { id: "b", date: day, entry_order: 1 }),
  ];
  ascending.forEach((earlier, i) =>
    ascending.slice(i + 1).forEach((later) => {
      expect(compareMovements(earlier, later)).toBeLessThan(0);
      expect(compareMovements(later, earlier)).toBeGreaterThan(0);
      expect(
        compareKeys(movementKey(later), movementKey(earlier)),
      ).toBeGreaterThan(0);
    }),
  );
});
