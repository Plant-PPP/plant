import type {
  Denominator,
  Movement,
  MovementCursor,
  MovementRefusal,
  Position,
  SaleResult,
} from "@plant/core";
import type { Currency, PortfolioSetupGuardHint } from "@plant/shared";

import type { HoldingRow } from "./read";

// Whose movements a list shows: one holding's, an account's or a
// portfolio's, or an instrument's in every account and portfolio.
export type MovementScope =
  | { holdingId: string }
  | { accountId: string }
  | { portfolioId: string }
  | { symbol: string };

// A movement as a list shows it, its money in the page's unit (null when it
// cannot be expressed in that unit): its amount (a purchase's cost, what a
// sale brought before charges, what an income paid, the cost an adjustment
// moved, what a yield earned or lost), and its charges.
export type MovementLine = {
  movement: Movement;
  amount: string | null;
  charges: string | null;
  operation: OperationParts;
};

// An operation's account and instrument, and every part of it: one movement
// per portfolio, with its account and the names of both. A transfer between
// accounts has one part in each; its account is the one the units leave.
export type OperationParts = {
  accountId: string;
  instrument: string;
  // The debt whose money the operation brought in, by its name.
  loan?: string;
  parts: {
    movement: Movement;
    accountId: string;
    institution: string;
    portfolioId: string;
    portfolioName: string;
  }[];
};

// A transfer as its dialog would send it, and the operation an edit replaces.
export type TransferCostQuery = { input: unknown; operationId: string | null };

export type MovementsPage =
  | { ok: true; rows: MovementLine[]; next: MovementCursor | null }
  | { ok: false; code: "failed" };

// A sale operation as the sales tab lists it: its parts the filters keep
// (each a portfolio's movement), the holding of its instrument in its account
// (open or closed), and what the parts made together.
export type SaleLine = {
  operationId: string;
  movements: Movement[];
  row: HoldingRow;
  sale: SaleResult | null;
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

// What a page with movements passes the holdings screen, in its unit: the
// position of each holding that has movements (a holding missing from
// `positions` has none), a number that changes whenever a holding's movements do
// (lists key on it), the sales of the chosen year, the years with sales
// (newest first), and the pages of movements of a scope.
export type MovementsInput = {
  positions: ReadonlyMap<string, Position>;
  revisions: ReadonlyMap<string, number>;
  sales: SalesSlice;
  years: readonly string[];
  // The first page of the page's own scope, read with the page.
  firstMovements?: MovementsPage;
  loadMovements: (
    scope: MovementScope,
    unit: Denominator,
    cursor: MovementCursor | null,
  ) => Promise<MovementsPage>;
  // The cost per unit, in the transfer's currency, its units would carry if
  // their cost were left to them; null when the transfer cannot be written. A
  // page that passes it offers transfers between portfolios.
  transferCost?: (query: TransferCostQuery) => Suggestion;
  // An instrument's latest price on a date in `currency`, from the feeds or
  // the user's manual prices; null when there is none in it. A yield's
  // dialog suggests it as the value of each unit.
  quoteOn?: (query: QuoteQuery) => Suggestion;
};

// A suggested price: worked out on the spot, or by the server later.
export type Suggestion = string | null | Promise<string | null>;

export type QuoteQuery = { symbol: string; currency: Currency; date: string };

export type MovementResult =
  | { ok: true; id: string }
  | {
      ok: false;
      code:
        | "invalid"
        | "not_found"
        | "failed"
        // A yield given as a balance the holding already held that day.
        | "same_balance"
        // A statement older than a balance the account already set of the
        // same instrument.
        | "opens_later"
        // An import confirmed against cash or holdings that changed after
        // the review read them.
        | "stale"
        // An edit of an operation its account's cash settled, whose legs
        // would no longer match it.
        | "settled"
        // An imported transfer to an account that is not another open one
        // of the user's.
        | "counterpart_not_found"
        // An imported transfer whose units the other account already shows
        // coming in.
        | "already_loaded"
        // An import that writes more operations than one confirmation takes.
        | "too_many_operations"
        | Extract<
            PortfolioSetupGuardHint,
            "portfolio_archived" | "source_connection_archived"
          >
        | MovementRefusal;
    };
