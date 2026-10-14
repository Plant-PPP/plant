import { quantityOn } from "@plant/core";
import {
  compareDecimals,
  exactOf,
  nonNegativeDecimalSchema,
  plus,
  positiveDecimalSchema,
  stored,
} from "@plant/shared";
import { z } from "zod";

import type { MovementResult } from "@/lib/holdings/movements-input";
import type { ImportRow } from "@/lib/imports/review";
import {
  allRows,
  difference,
  holdingIn,
  holdingsView,
  type Ledger,
  type Write,
  writeOperation,
} from "@/lib/ledger/ledger";

// The account's open instrument holdings, largest first.
function heldHoldings(state: Ledger, accountId: string) {
  return holdingsView(state)
    .active.filter(
      (row) =>
        row.account.id === accountId &&
        row.holding.asset_class === "instrument",
    )
    .sort((a, b) => compareDecimals(b.holding.amount, a.holding.amount));
}

// Each instrument the account held at the end of a day, summed across its
// portfolios: what its movements up to that day leave, in holdings open or
// closed since. Today's is what the account holds now.
export function heldOn(
  state: Ledger,
  accountId: string,
  date: string,
): Map<string, string> {
  const held = new Map<string, string>();
  for (const { symbol, quantity } of holdingsOn(state, accountId, date)) {
    held.set(
      symbol,
      stored(plus(exactOf(held.get(symbol) ?? "0"), exactOf(quantity))),
    );
  }
  return held;
}

// The account's instrument holdings with units at the end of a day, with
// how many, largest first.
export function holdingsOn(state: Ledger, accountId: string, date: string) {
  return allRows(state)
    .flatMap((row) => {
      if (
        row.account.id !== accountId ||
        row.holding.asset_class !== "instrument"
      ) {
        return [];
      }
      const quantity = quantityOn(state.movements.get(row.id) ?? [], date);
      return compareDecimals(quantity, "0") > 0
        ? [{ row, symbol: row.holding.instrument_symbol, quantity }]
        : [];
    })
    .sort((a, b) => compareDecimals(b.quantity, a.quantity));
}

// The instruments whose balance the account set after a day, with an opening
// balance or an adjustment (a later statement's, or one typed by hand). A
// statement of that day booked under it would move that balance too; later
// trades are weighed as they are.
export function balancedAfter(
  state: Ledger,
  accountId: string,
  date: string,
): Set<string> {
  const later = new Set<string>();
  for (const row of allRows(state)) {
    if (
      row.account.id !== accountId ||
      row.holding.asset_class !== "instrument"
    ) {
      continue;
    }
    const own = state.movements.get(row.id) ?? [];
    if (
      own.some(
        (each) =>
          each.date > date &&
          (each.kind === "opening_balance" || each.kind === "adjustment"),
      )
    ) {
      later.add(row.holding.instrument_symbol);
    }
  }
  return later;
}

// Each instrument the account holds, summed across its portfolios.
export function heldIn(state: Ledger, accountId: string): Map<string, string> {
  const held = new Map<string, string>();
  for (const row of heldHoldings(state, accountId)) {
    if (row.holding.asset_class !== "instrument") continue;
    const symbol = row.holding.instrument_symbol;
    held.set(
      symbol,
      stored(
        plus(exactOf(held.get(symbol) ?? "0"), exactOf(row.holding.amount)),
      ),
    );
  }
  return held;
}

// The user's other accounts holding each instrument, by symbol: where a
// statement's units may come from as a transfer.
export function heldElsewhere(
  state: Ledger,
  accountId: string,
): Map<string, { id: string; institution: string }[]> {
  const elsewhere = new Map<string, { id: string; institution: string }[]>();
  for (const row of holdingsView(state).active) {
    if (
      row.account.id === accountId ||
      row.holding.asset_class !== "instrument"
    ) {
      continue;
    }
    const symbol = row.holding.instrument_symbol;
    const accounts = elsewhere.get(symbol) ?? [];
    if (!accounts.some((each) => each.id === row.account.id)) {
      accounts.push({
        id: row.account.id,
        institution: row.account.institution,
      });
    }
    elsewhere.set(symbol, accounts);
  }
  return elsewhere;
}

// A row as the review hands it over: a discarded one may hold anything typed.
const reviewedRowSchema = z.union([
  z.object({ discarded: z.literal(true) }),
  z.object({
    discarded: z.literal(false),
    symbol: z.string().min(1),
    quantity: positiveDecimalSchema,
    price: nonNegativeDecimalSchema.nullable(),
    cost: positiveDecimalSchema.nullable().optional(),
    portfolioId: z.string().min(1).optional(),
    transferFrom: z.string().min(1).optional(),
  }),
]);

// A statement being confirmed: its account, the date its holdings are at,
// and its file's name, which each operation's note carries.
export type ImportToWrite = {
  id: string;
  accountId: string;
  date: string;
  fileName: string;
};

// What the review's rows write: the ledger after them, and the operations
// they wrote in order; none on a refusal.
export type ImportWrite<S extends Ledger> = Write<MovementResult, S> & {
  operations: string[];
};

// The account as the reviewed rows say: for each instrument, an opening
// balance where it has none and an adjustment for any difference, all or
// nothing. What the document does not list stays as it is.
export function writeImport<S extends Ledger>(
  state: S,
  item: ImportToWrite,
  rows: readonly ImportRow[],
  newId: () => string,
): ImportWrite<S> {
  const operations: string[] = [];
  const refuse = (
    result: Extract<MovementResult, { ok: false }>,
  ): ImportWrite<S> => ({ state, result, operations: [] });
  const account = state.accounts.find((each) => each.id === item.accountId);
  if (!account) return refuse({ ok: false, code: "not_found" });
  if (!z.array(reviewedRowSchema).safeParse(rows).success) {
    return refuse({ ok: false, code: "invalid" });
  }
  const kept = rows.filter((row) => !row.discarded);
  // Each row is weighed against what the account held before, so an
  // instrument listed twice would be counted twice.
  if (new Set(kept.map((row) => row.symbol)).size !== kept.length) {
    return refuse({ ok: false, code: "invalid" });
  }
  let next = state;
  // Each row is weighed against what the account held at the end of the
  // statement's day, and the difference is booked on that day. A later sale
  // that needs the units, a portfolio archived since or a holding that opens
  // later refuses the write, as it would refuse a movement typed by hand.
  const date = item.date;
  const held = heldOn(state, account.id, date);
  const later = balancedAfter(state, account.id, date);
  for (const row of kept) {
    const instrument = state.instruments.find(
      (each) => each.symbol === row.symbol,
    );
    if (!instrument) return refuse({ ok: false, code: "not_found" });
    const diff = difference(row.quantity, held.get(row.symbol) ?? "0");
    const order = compareDecimals(diff, "0");
    if (order === 0) continue;
    if (later.has(row.symbol))
      return refuse({ ok: false, code: "opens_later" });
    // The holdings of the instrument with units on that day, largest first.
    const holdings = holdingsOn(next, account.id, date)
      .filter((each) => each.symbol === row.symbol)
      .map(({ row: holding, quantity }) => ({ ...holding, quantity }));
    // More units come in to the portfolio the review chose, else the one
    // holding the most, or the account's default for a new instrument: from
    // another account as a transfer, carrying their cost, or else at the
    // price read. Fewer go out of the largest holdings first.
    const destination =
      row.portfolioId ?? holdings[0]?.portfolio.id ?? account.portfolio.id;
    if (order > 0 && row.transferFrom !== undefined) {
      const source = holdingsOn(next, row.transferFrom, date).find(
        (each) => each.symbol === row.symbol,
      )?.row;
      if (!source || row.transferFrom === account.id) {
        return refuse({ ok: false, code: "not_found" });
      }
      const operationId = newId();
      const moved = writeOperation(
        next,
        {
          kind: "transfer",
          source_connection_id: row.transferFrom,
          instrument_symbol: row.symbol,
          date,
          currency: instrument.currency,
          parts: [
            {
              portfolio_id: source.portfolio.id,
              direction: "out",
              quantity: diff,
            },
            {
              portfolio_id: destination,
              source_connection_id: account.id,
              direction: "in",
              quantity: diff,
              price: null,
            },
          ],
          reference: null,
          note: `Carga de ${item.fileName}`.slice(0, 200),
        },
        {
          operationId,
          newId,
          origin: { kind: "import", fileName: item.fileName, date },
        },
      );
      if (!moved.result.ok) return refuse(moved.result);
      operations.push(operationId);
      next = moved.state;
      continue;
    }
    let parts: { portfolio_id: string; quantity: string }[];
    if (order > 0) {
      parts = [{ portfolio_id: destination, quantity: diff }];
    } else {
      let left = difference("0", diff);
      parts = [];
      for (const each of holdings) {
        if (compareDecimals(left, "0") <= 0) break;
        const units = each.quantity;
        const taken = compareDecimals(units, left) < 0 ? units : left;
        parts.push({ portfolio_id: each.portfolio.id, quantity: taken });
        left = difference(left, taken);
      }
    }
    // A portfolio that held it before, even down to zero, adjusts; one that
    // never did opens with a balance.
    const opens =
      order > 0 &&
      holdingIn(next, account.id, row.symbol, parts[0]!.portfolio_id) ===
        undefined;
    // A holding that opens comes in at the average cost the review kept, the
    // whole position's; units added to one already held come in at the price,
    // as the average of the whole is not theirs, and at the cost only when no
    // price was kept.
    const entry =
      (opens ? (row.cost ?? row.price) : (row.price ?? row.cost)) ?? null;
    if (order > 0 && (entry === null || compareDecimals(entry, "0") <= 0)) {
      return refuse({ ok: false, code: "invalid" });
    }
    const operationId = newId();
    const written = writeOperation(
      next,
      {
        kind: opens ? "opening_balance" : "adjustment",
        ...(!opens && { direction: order > 0 ? "in" : "out" }),
        source_connection_id: account.id,
        instrument_symbol: row.symbol,
        date,
        currency: instrument.currency,
        price: order > 0 ? entry : "0",
        parts,
        charges: [],
        reference: null,
        note: `Carga de ${item.fileName}`.slice(0, 200),
      },
      {
        operationId,
        newId,
        origin: { kind: "import", fileName: item.fileName, date },
      },
    );
    if (!written.result.ok) return refuse(written.result);
    operations.push(operationId);
    next = written.state;
  }
  return { state: next, result: { ok: true, id: item.id }, operations };
}
