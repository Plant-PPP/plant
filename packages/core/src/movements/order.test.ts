import { income, trade } from "./fixtures.test-support";
import { compareKeys, compareMovements, movementKey } from "./order";

it("orders by date, then opening balance, purchases, income and sales", () => {
  const sale = trade("sale", "1", "10", { id: "a", date: "2026-03-02" });
  const purchase = trade("purchase", "1", "10", {
    id: "z",
    date: "2026-03-02",
  });
  const dividend = income("dividend", "1", { id: "b", date: "2026-03-02" });
  const opening = trade("opening_balance", "1", "10", {
    id: "y",
    date: "2026-03-02",
  });
  const earlier = trade("sale", "1", "10", { id: "c", date: "2026-03-01" });
  expect(
    [sale, purchase, dividend, opening, earlier]
      .sort(compareMovements)
      .map((m) => m.id),
  ).toEqual(["c", "y", "z", "b", "a"]);
});

it("breaks a tie by id", () => {
  const a = trade("purchase", "1", "10", { id: "a", date: "2026-03-02" });
  const b = trade("purchase", "1", "10", { id: "b", date: "2026-03-02" });
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
