import { type ClosesState } from "./compute";
import { scopedState } from "./scope";

const stored = (id: string, accountId: string, portfolioId: string) => ({
  holding: { id },
  accountId,
  portfolioId,
  closed: false,
});

const state = {
  holdings: [
    stored("h1", "a1", "p1"),
    stored("h2", "a2", "p1"),
    stored("h3", "a1", "p2"),
  ],
  cashMovements: new Map([
    ["h1", [{ id: "m1" }]],
    ["h2", [{ id: "m2" }]],
  ]),
  liabilities: [{ id: "d1" }],
  liabilityEvents: new Map([["d1", []]]),
} as unknown as ClosesState;

const ids = (scoped: ClosesState) => ({
  holdings: scoped.holdings.map((each) => each.holding.id),
  cash: [...(scoped.cashMovements?.keys() ?? [])],
});

describe("scopedState", () => {
  it("keeps an account's holdings and their cash, and no debts", () => {
    const scoped = scopedState(state, { accountId: "a1" });
    expect(ids(scoped)).toEqual({ holdings: ["h1", "h3"], cash: ["h1"] });
    expect(scoped.liabilities).toEqual([]);
    expect(scoped.liabilityEvents.size).toBe(0);
  });

  it("keeps a portfolio's holdings across its accounts", () => {
    expect(ids(scopedState(state, { portfolioId: "p1" }))).toEqual({
      holdings: ["h1", "h2"],
      cash: ["h1", "h2"],
    });
  });
});
