// What public.move_cash, and update_liability_event for a link it keeps, raise
// when a cash holding cannot be used as asked: the SQLSTATE and the hints the
// app maps to its copy.
export const CASH_MOVE_GUARD = {
  sqlstate: "PT409",
  hints: ["currency", "stale", "insufficient_cash"],
} as const;

export type CashMoveGuardHint = (typeof CASH_MOVE_GUARD.hints)[number];
