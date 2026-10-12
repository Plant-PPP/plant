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
import {
  type ImportItem,
  type ImportRow,
  readTotals,
} from "@/lib/imports/review";

import {
  difference,
  holdingIn,
  holdingsView,
  priceToday,
  type PrototypeState,
  type Write,
  writeOperation,
} from "./prototype-store";

// The files the reading takes: statements and screenshots.
const READABLE = /\.(pdf|png|jpe?g|heic|webp|csv|xlsx?)$/i;

const withImport = (
  state: PrototypeState,
  id: string,
  change: (item: ImportItem) => ImportItem,
): PrototypeState => ({
  ...state,
  imports: state.imports.map((item) => (item.id === id ? change(item) : item)),
});

export function addImport(
  state: PrototypeState,
  {
    id,
    fileName,
    accountId,
  }: { id: string; fileName: string; accountId: string },
): Write<{ ok: true; id: string }> {
  const item: ImportItem = {
    id,
    fileName,
    accountId,
    status: "queued",
    error: null,
    documentDate: null,
    documentTotals: [],
    rows: [],
    createdOn: state.today,
  };
  return {
    state: { ...state, imports: [item, ...state.imports] },
    result: { ok: true, id },
  };
}

export const startReading = (state: PrototypeState, id: string) =>
  withImport(state, id, (item) => ({ ...item, status: "reading" }));

// The account's open instrument holdings with what each holds, largest
// first.
function heldHoldings(state: PrototypeState, accountId: string) {
  return holdingsView(state)
    .active.flatMap((row) =>
      row.account.id === accountId && row.holding.asset_class === "instrument"
        ? [{ row, quantity: row.holding.amount }]
        : [],
    )
    .sort((a, b) => compareDecimals(b.quantity, a.quantity));
}

// Each instrument the account holds, summed across its portfolios.
export function heldIn(
  state: PrototypeState,
  accountId: string,
): Map<string, string> {
  const held = new Map<string, string>();
  for (const { row, quantity } of heldHoldings(state, accountId)) {
    if (row.holding.asset_class !== "instrument") continue;
    const symbol = row.holding.instrument_symbol;
    held.set(
      symbol,
      stored(plus(exactOf(held.get(symbol) ?? "0"), exactOf(quantity))),
    );
  }
  return held;
}

// What the reading makes of a statement, standing in for the AI: the
// account's holdings with one more, one fewer, one unchanged, one misread
// with low confidence, and an instrument the account does not have yet. The
// printed totals are the true ones, so the misread row does not add up.
export function finishReading(
  state: PrototypeState,
  id: string,
): PrototypeState {
  const item = state.imports.find((each) => each.id === id);
  if (!item) return state;
  if (!READABLE.test(item.fileName)) {
    return withImport(state, id, (each) => ({
      ...each,
      status: "failed",
      error:
        "No podemos leer ese tipo de archivo. Subí un PDF, una foto o un Excel.",
    }));
  }
  const held = heldIn(state, item.accountId);
  if (held.size === 0 || /vac[ií]o|empty/i.test(item.fileName)) {
    return withImport(state, id, (each) => ({
      ...each,
      status: "failed",
      error: "No encontramos tenencias en el documento.",
    }));
  }
  // Priced as the page values them: the feeds, else the user's manual price.
  const instrumentOf = (symbol: string) =>
    state.instruments.find((each) => each.symbol === symbol)!;
  const priceOf = (symbol: string) => priceToday(state, instrumentOf(symbol));
  const symbols = [...held.keys()].sort();
  const truth: ImportRow[] = symbols.map((symbol, index) => {
    const quantity = held.get(symbol)!;
    const changed =
      index === 0
        ? stored(plus(exactOf(quantity), exactOf("5")))
        : index === 2 && compareDecimals(quantity, "1") > 0
          ? difference(quantity, "1")
          : quantity;
    return {
      id: `${id}-${index}`,
      symbol,
      quantity: changed,
      price: priceOf(symbol),
      currency: instrumentOf(symbol).currency,
      confidence: index === 2 ? "medium" : "high",
      source: `Página ${1 + Math.floor(index / 3)}`,
      discarded: false,
    };
  });
  const currencies = new Set(truth.map((row) => row.currency));
  const extra = state.instruments.find(
    (each) =>
      !held.has(each.symbol) &&
      currencies.has(each.currency) &&
      priceOf(each.symbol) !== null,
  );
  if (extra) {
    truth.push({
      id: `${id}-new`,
      symbol: extra.symbol,
      quantity: "3",
      price: priceOf(extra.symbol),
      currency: extra.currency,
      confidence: "medium",
      source: "Página 2",
      discarded: false,
    });
  }
  // The last row read with a digit missing.
  const misread = truth.at(-2) ?? truth[0]!;
  const rows = truth.map((row) =>
    row.id === misread.id && compareDecimals(row.quantity, "10") >= 0
      ? {
          ...row,
          quantity: stored({
            n: exactOf(row.quantity).n,
            d: exactOf(row.quantity).d * 10n,
          }),
          confidence: "low" as const,
        }
      : row,
  );
  return withImport(state, id, (each) => ({
    ...each,
    status: "ready",
    documentDate: state.today,
    documentTotals: readTotals(truth),
    rows,
  }));
}

// A row as the review hands it over: a discarded one may hold anything typed.
const reviewedRowSchema = z.union([
  z.object({ discarded: z.literal(true) }),
  z.object({
    discarded: z.literal(false),
    symbol: z.string().min(1),
    quantity: positiveDecimalSchema,
    price: nonNegativeDecimalSchema.nullable(),
  }),
]);

// The account as the reviewed rows say: for each instrument, an opening
// balance where it has none and an adjustment for any difference, all or
// nothing. What the document does not list stays as it is.
export function confirmImport(
  state: PrototypeState,
  id: string,
  rows: readonly ImportRow[],
  newId: () => string,
): Write<MovementResult> {
  const item = state.imports.find((each) => each.id === id);
  const account =
    item && state.accounts.find((each) => each.id === item.accountId);
  if (!item || !account || item.status !== "ready") {
    return { state, result: { ok: false, code: "not_found" } };
  }
  if (!z.array(reviewedRowSchema).safeParse(rows).success) {
    return { state, result: { ok: false, code: "invalid" } };
  }
  const kept = rows.filter((row) => !row.discarded);
  // Each row is weighed against what the account held before, so an
  // instrument listed twice would be counted twice.
  if (new Set(kept.map((row) => row.symbol)).size !== kept.length) {
    return { state, result: { ok: false, code: "invalid" } };
  }
  let next = state;
  // Each row is weighed against what the account holds and the difference is
  // booked today: a statement's own date needs the holdings on that day,
  // which waits for readings that carry one (PLA-42).
  const date = state.today;
  const held = heldIn(state, account.id);
  for (const row of kept) {
    const instrument = state.instruments.find(
      (each) => each.symbol === row.symbol,
    );
    if (!instrument) return { state, result: { ok: false, code: "not_found" } };
    const diff = difference(row.quantity, held.get(row.symbol) ?? "0");
    const order = compareDecimals(diff, "0");
    if (order === 0) continue;
    const holdings = heldHoldings(next, account.id).filter(
      ({ row: each }) =>
        each.holding.asset_class === "instrument" &&
        each.holding.instrument_symbol === row.symbol,
    );
    // More units come in at the price read, to the portfolio holding the
    // most, or the account's default for a new instrument; fewer go out of
    // the largest holdings first.
    let parts: { portfolio_id: string; quantity: string }[];
    if (order > 0) {
      if (row.price === null || compareDecimals(row.price, "0") <= 0) {
        return { state, result: { ok: false, code: "invalid" } };
      }
      parts = [
        {
          portfolio_id: holdings[0]?.row.portfolio.id ?? account.portfolio.id,
          quantity: diff,
        },
      ];
    } else {
      let left = difference("0", diff);
      parts = [];
      for (const { row: each, quantity } of holdings) {
        if (compareDecimals(left, "0") <= 0) break;
        const taken = compareDecimals(quantity, left) < 0 ? quantity : left;
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
    const written = writeOperation(
      next,
      {
        kind: opens ? "opening_balance" : "adjustment",
        ...(!opens && { direction: order > 0 ? "in" : "out" }),
        source_connection_id: account.id,
        instrument_symbol: row.symbol,
        date,
        currency: instrument.currency,
        price: order > 0 ? row.price : "0",
        parts,
        charges: [],
        reference: null,
        note: `Carga de ${item.fileName}`.slice(0, 200),
      },
      { operationId: newId(), newId },
    );
    if (!written.result.ok) return { state, result: written.result };
    next = written.state;
  }
  return {
    state: withImport(next, id, (each) => ({
      ...each,
      status: "confirmed",
      rows: [...rows],
    })),
    result: { ok: true, id },
  };
}
