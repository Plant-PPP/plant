import type { ClosesState } from "./compute";

// What an account's or a portfolio's closes add up: its holdings, open or
// closed, and their cash histories. Debts belong to no account, so a scope's
// closes leave them out.
export function scopedState(
  state: ClosesState,
  scope: { accountId: string } | { portfolioId: string },
): ClosesState {
  const holdings = state.holdings.filter((each) =>
    "accountId" in scope
      ? each.accountId === scope.accountId
      : each.portfolioId === scope.portfolioId,
  );
  const ids = new Set(holdings.map((each) => each.holding.id));
  return {
    ...state,
    holdings,
    liabilities: [],
    liabilityEvents: new Map(),
    cashMovements: new Map(
      [...(state.cashMovements ?? new Map())].filter(([id]) => ids.has(id)),
    ),
  };
}
