// What the portfolio setup triggers raise when a write would break one of the
// user's invariants (supabase/migrations/*_portfolios.sql): the SQLSTATE and the
// hints the app maps to its copy. PostgREST answers PTxyz as HTTP xyz.
export const PORTFOLIO_SETUP_GUARD = {
  sqlstate: "PT409",
  hints: ["last_active_portfolio"],
} as const;

export type PortfolioSetupGuardHint =
  (typeof PORTFOLIO_SETUP_GUARD.hints)[number];
