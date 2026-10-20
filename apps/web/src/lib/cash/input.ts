import type { Currency } from "@plant/shared";

// What the user records of an account's cash by hand.
export const CASH_ENTRY_KINDS = [
  "opening_balance",
  "deposit",
  "withdrawal",
] as const;
export type CashEntryKind = (typeof CASH_ENTRY_KINDS)[number];

// The currencies an account's cash is kept in.
export const CASH_CURRENCIES: readonly Currency[] = ["ARS", "USD"];

export type CashRefusalCode =
  | "invalid"
  | "not_found"
  | "failed"
  | "no_rate"
  | "needs_opening"
  | "before_opening"
  | "future"
  | "negative_cash"
  | "other_account"
  | "stale";

export type CashResult = { ok: true } | { ok: false; code: CashRefusalCode };

// What a statement holds and what reading it would write: its days, its rows
// and those skipped (not finished, or an instrument Plant does not know),
// the operations Plant has that it settles and those it would create, rows
// the account's cash already has, and each currency's new movements and the
// opening balance a currency with no history would take.
export type StatementSummary = {
  from: string | null;
  to: string | null;
  rows: number;
  skipped: number;
  matched: number;
  created: number;
  known: number;
  cash: { currency: Currency; count: number; opening: string | null }[];
};

export type StatementResult =
  | { ok: true; written: boolean; summary: StatementSummary }
  | {
      ok: false;
      code: CashRefusalCode | "unsupported" | "too_large";
      summary?: StatementSummary;
    };
