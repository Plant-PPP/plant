import type {
  Denominator,
  Movement,
  MovementCursor,
  MovementRefusal,
  Position,
  SaleResult,
} from "@plant/core";

import type { HoldingRow } from "./read";

// Whose movements a list shows: one holding's, or every holding's in an
// account or a portfolio.
export type MovementScope =
  { holdingId: string } | { accountId: string } | { portfolioId: string };

// A movement as a list shows it, its money in the page's unit (null when it
// cannot be expressed in that unit): what it cost or paid (a sale's cost is
// that of the units it sold), and its fees and taxes together.
export type MovementLine = {
  movement: Movement;
  cost: string | null;
  charges: string | null;
};

export type MovementsPage =
  | { ok: true; rows: MovementLine[]; next: MovementCursor | null }
  | { ok: false; code: "failed" };

// A sale with its holding, open or closed.
export type SaleLine = {
  movement: Movement;
  sale: SaleResult | null;
  row: HoldingRow;
};

// The sales of one year whose holding, active or not, matches the page's
// filters, newest first: at most SALES_LIMIT rows, and the totals of every
// one of them. A total is null when a sale cannot be expressed in the unit.
export type SalesSlice = {
  rows: SaleLine[];
  truncated: boolean;
  totals: {
    count: number;
    gross: string | null;
    charges: string | null;
    result: string | null;
  };
};

// What a page with movements passes the holdings screen, in its unit: each
// holding's position, a number that changes whenever a holding's movements do
// (lists key on it), the sales of the chosen year, the years with sales
// (newest first), and the pages of movements of a scope.
export type MovementsInput = {
  positions: ReadonlyMap<string, Position>;
  revisions: ReadonlyMap<string, number>;
  sales: SalesSlice;
  years: readonly string[];
  loadMovements: (
    scope: MovementScope,
    unit: Denominator,
    cursor: MovementCursor | null,
  ) => Promise<MovementsPage>;
};

export type MovementResult =
  | { ok: true; id: string }
  | {
      ok: false;
      code: "invalid" | "not_found" | "failed" | MovementRefusal;
    };
