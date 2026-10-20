import {
  type CashMovement,
  type CashMovementKind,
  type InstrumentIndex,
  resolveSymbol,
} from "@plant/core";
import type { IolMovementRow } from "@plant/sources";
import {
  type Currency,
  compareDecimals,
  exactOf,
  minus,
  negated,
  plus,
  stored,
  ZERO,
} from "@plant/shared";

import { allRows, type Ledger } from "@/lib/ledger/ledger";
import type { ImportOperationRow } from "@/lib/imports/review";

// A broker's statement of an account's money: each row one account side of
// a movement, under the broker's number for it. Read into the account's cash
// histories, one per currency, and the operations Plant lacks.
export type StatementRow = IolMovementRow;

// What the account's cash in one currency is before the statement: its
// holding (null when it has none), what it holds today, and its history.
export type CashSide = {
  holdingId: string | null;
  today: string;
  history: readonly CashMovement[];
};

// One cash movement the statement adds: an operation's leg names the
// operation it settles, already in Plant or created from the row numbered
// `number`.
export type PlannedCash = {
  kind: Exclude<CashMovementKind, "opening_balance">;
  date: string;
  amount: string;
  reference: string | null;
  operation: { id: string } | { number: string } | null;
};

export type StatementPlan = {
  // Operations to create, oldest first, each numbered as the broker does.
  create: ImportOperationRow[];
  cash: Map<Currency, PlannedCash[]>;
  // The opening balance a currency with no history takes, dated the
  // statement's first day: what it holds today less what the statement adds.
  openings: Map<Currency, { date: string; amount: string }>;
  // Operations already in Plant the statement settles, rows already in the
  // account's cash, and rows Plant could not place (an instrument it does
  // not know).
  matched: number;
  known: number;
  skipped: number;
  from: string | null;
  to: string | null;
};

const TRADES = new Set(["purchase", "sale"]);
const DAY_ORDER = { purchase: 0, dividend: 1, sale: 2 } as const;

const chargesOf = (row: StatementRow) =>
  stored(
    plus(exactOf(row.commission), exactOf(row.vat), exactOf(row.otherTaxes)),
  );

// The side of a trade that moved its units: the other only paid a fee in
// its own currency (all of its amount is other taxes).
const isFeeSide = (row: StatementRow) =>
  compareDecimals(row.commission, "0") === 0 &&
  compareDecimals(row.vat, "0") === 0 &&
  compareDecimals(row.otherTaxes, "0") > 0 &&
  compareDecimals(stored(negated(exactOf(row.amount))), row.otherTaxes) === 0;

// The account's operations by the broker's number, of a kind a statement
// settles.
function operationsByNumber(
  ledger: Ledger,
  accountId: string,
): Map<string, { id: string; kind: string }> {
  const found = new Map<string, { id: string; kind: string }>();
  for (const row of allRows(ledger)) {
    if (row.account.id !== accountId) continue;
    for (const movement of ledger.movements.get(row.id) ?? []) {
      if (movement.reference === null) continue;
      if (!["purchase", "sale", "dividend", "coupon"].includes(movement.kind)) {
        continue;
      }
      found.set(`${movement.kind}:${movement.reference}`, {
        id: movement.operation_id,
        kind: movement.kind,
      });
    }
  }
  return found;
}

// Works out what a statement writes into an account: a leg for each side of
// an operation, matched to the one Plant has by the broker's number and kind
// or created from the row; deposits, withdrawals and credits as they are; a
// dividend's fee charged under its own number as a charge. What a currency's
// history already holds is left out, so a statement read twice adds
// nothing. A sync's cash (`create` false) settles only the operations Plant
// has, as the review confirmed them, takes a dividend it lacks as income,
// and opens a currency at the balance
// the provider gave (`given`) when it says.
export function planStatement(
  rows: readonly StatementRow[],
  {
    ledger,
    accountId,
    cash,
    index,
    create: creates = true,
    given = [],
  }: {
    ledger: Ledger;
    accountId: string;
    cash: ReadonlyMap<Currency, CashSide>;
    index: InstrumentIndex;
    create?: boolean;
    given?: readonly { currency: Currency; date: string; amount: string }[];
  },
): StatementPlan {
  const existing = operationsByNumber(ledger, accountId);
  const planned = new Map<Currency, PlannedCash[]>();
  const create: ImportOperationRow[] = [];
  let matched = 0;
  let known = 0;
  let skipped = 0;

  const side = (currency: Currency) =>
    cash.get(currency) ?? { holdingId: null, today: "0", history: [] };
  const add = (currency: Currency, movement: PlannedCash) => {
    if (compareDecimals(movement.amount, "0") === 0) return;
    const { history } = side(currency);
    const seen =
      movement.kind === "settlement"
        ? "id" in movement.operation! &&
          history.some(
            (each) =>
              each.kind === "settlement" &&
              each.operation_id === (movement.operation as { id: string }).id,
          )
        : history.some((each) => each.reference === movement.reference);
    if (seen) {
      known += 1;
      return;
    }
    planned.set(currency, [...(planned.get(currency) ?? []), movement]);
  };

  // Trades and dividends by number; a number's rows are the sides of one
  // movement.
  const groups = new Map<string, StatementRow[]>();
  for (const row of rows) {
    if (row.kind === "deposit" || row.kind === "withdrawal") {
      add(row.currency, {
        kind: row.kind,
        date: row.date,
        amount: row.amount,
        reference: row.number,
        operation: null,
      });
      continue;
    }
    if (row.kind === "credit") {
      add(row.currency, {
        kind: compareDecimals(row.amount, "0") < 0 ? "charge" : "income",
        date: row.date,
        amount: row.amount,
        reference: row.number,
        operation: null,
      });
      continue;
    }
    const key = `${row.kind}:${row.number}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }

  for (const [key, sides] of groups) {
    const main =
      sides.find((row) =>
        row.kind === "dividend"
          ? compareDecimals(row.amount, "0") > 0
          : !isFeeSide(row),
      ) ?? null;
    // A dividend's fee under its own number pays for no operation of its
    // own: a charge of its cash.
    if (!main) {
      for (const row of sides) {
        if (row.kind === "dividend" || isFeeSide(row)) {
          add(row.currency, {
            kind: compareDecimals(row.amount, "0") < 0 ? "charge" : "income",
            date: row.date,
            amount: row.amount,
            reference: row.number,
            operation: null,
          });
        } else skipped += 1;
      }
      continue;
    }
    const found = existing.get(key);
    let operation: PlannedCash["operation"];
    if (found) {
      matched += 1;
      operation = { id: found.id };
    } else if (!creates) {
      // A dividend Plant has no operation for was still paid: income.
      for (const row of sides) {
        if (row.kind === "dividend") {
          add(row.currency, {
            kind: compareDecimals(row.amount, "0") < 0 ? "charge" : "income",
            date: row.date,
            amount: row.amount,
            reference: row.number,
            operation: null,
          });
        } else skipped += 1;
      }
      continue;
    } else {
      const resolved = main.symbol && resolveSymbol(main.symbol, index);
      if (!resolved) {
        skipped += sides.length;
        continue;
      }
      const charges = chargesOf(main);
      create.push({
        id: main.number,
        date: main.date,
        kind: main.kind as "purchase" | "sale" | "dividend",
        symbol: resolved.symbol,
        quantity: TRADES.has(main.kind) ? main.quantity : null,
        price: TRADES.has(main.kind) ? main.price : null,
        amount:
          main.kind === "dividend"
            ? stored(plus(exactOf(main.amount), exactOf(charges)))
            : null,
        charges: compareDecimals(charges, "0") > 0 ? charges : null,
        reference: main.number,
        currency: main.currency,
        confidence: "high",
        source: "",
        discarded: false,
      });
      operation = { number: main.number };
    }
    for (const row of sides) {
      add(row.currency, {
        kind: "settlement",
        date: main.date,
        amount: row.amount,
        reference: row.number,
        operation,
      });
    }
  }

  const dates = rows.map((row) => row.date).sort();
  const from = dates[0] ?? null;
  const openings = new Map<Currency, { date: string; amount: string }>();
  for (const [currency, movements] of planned) {
    const { history, today } = side(currency);
    if (history.length > 0 || from === null) continue;
    const opening = given.find((each) => each.currency === currency);
    if (opening) {
      openings.set(currency, { date: opening.date, amount: opening.amount });
      continue;
    }
    const added = movements.reduce(
      (sum, movement) => plus(sum, exactOf(movement.amount)),
      ZERO,
    );
    openings.set(currency, {
      date: from,
      amount: stored(minus(exactOf(today), added)),
    });
  }
  create.sort(
    (a, b) =>
      a.date!.localeCompare(b.date!) ||
      DAY_ORDER[a.kind as keyof typeof DAY_ORDER] -
        DAY_ORDER[b.kind as keyof typeof DAY_ORDER],
  );
  return {
    create,
    cash: planned,
    openings,
    matched,
    known,
    skipped,
    from,
    to: dates.at(-1) ?? null,
  };
}
