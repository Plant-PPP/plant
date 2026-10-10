// What the portfolio setup triggers raise when a write would break one of the
// user's invariants (the private.guard_*_write functions in
// supabase/migrations): the SQLSTATE and the hints the app maps to its copy.
// PostgREST answers PTxyz as HTTP xyz.
export const PORTFOLIO_SETUP_GUARD = {
  sqlstate: "PT409",
  hints: [
    "last_active_portfolio",
    "portfolio_in_use",
    "portfolio_archived",
    "holder_in_use",
    "holder_archived",
    "portfolio_has_holdings",
    "source_connection_has_holdings",
    "source_connection_archived",
  ],
} as const;

export type PortfolioSetupGuardHint =
  (typeof PORTFOLIO_SETUP_GUARD.hints)[number];
