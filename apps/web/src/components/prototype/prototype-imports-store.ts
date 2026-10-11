import { snapshotOn } from "@plant/core";
import { compareDecimals, exactOf, plus, toDecimal } from "@plant/shared";

import type { MovementResult } from "@/lib/holdings/movements-input";
import {
  type ImportItem,
  type ImportRow,
  readTotals,
} from "@/lib/imports/review";

import {
  holdingsView,
  type PrototypeState,
  type Write,
  writeOperation,
} from "./prototype-store";

// The files the reading takes: statements and screenshots.
const READABLE = /\.(pdf|png|jpe?g|heic|webp|csv|xlsx?)$/i;

const minus = (a: string, b: string) =>
  toDecimal(plus(exactOf(a), { ...exactOf(b), n: -exactOf(b).n }), 8);

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

// Each instrument the account holds, summed across its portfolios.
function heldIn(state: PrototypeState, accountId: string): Map<string, string> {
  const held = new Map<string, string>();
  for (const row of holdingsView(state).active) {
    if (row.account.id !== accountId) continue;
    if (row.holding.asset_class !== "instrument") continue;
    const symbol = row.holding.instrument_symbol;
    held.set(
      symbol,
      toDecimal(
        plus(exactOf(held.get(symbol) ?? "0"), exactOf(row.holding.amount)),
        8,
      ),
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
  const { prices } = snapshotOn(state.quotes, state.today, {
    fxKinds: [],
    symbols: state.instruments.map(({ symbol }) => symbol),
  }).snapshot;
  const priceOf = (symbol: string) => prices[symbol];
  const symbols = [...held.keys()].sort();
  const truth: ImportRow[] = symbols.map((symbol, index) => {
    const quantity = held.get(symbol)!;
    const changed =
      index === 0
        ? toDecimal(plus(exactOf(quantity), exactOf("5")), 8)
        : index === 2 && compareDecimals(quantity, "1") > 0
          ? minus(quantity, "1")
          : quantity;
    const quote = priceOf(symbol);
    return {
      id: `${id}-${index}`,
      symbol,
      quantity: changed,
      price: quote?.price ?? null,
      currency: quote?.currency ?? "ARS",
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
      priceOf(each.symbol),
  );
  if (extra) {
    truth.push({
      id: `${id}-new`,
      symbol: extra.symbol,
      quantity: "3",
      price: priceOf(extra.symbol)!.price,
      currency: priceOf(extra.symbol)!.currency,
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
          quantity: toDecimal(
            { n: exactOf(row.quantity).n, d: exactOf(row.quantity).d * 10n },
            8,
          ),
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
  let next = state;
  const held = heldIn(state, account.id);
  for (const row of rows) {
    if (row.discarded) continue;
    const before = held.get(row.symbol);
    const diff = minus(row.quantity, before ?? "0");
    const order = compareDecimals(diff, "0");
    if (order === 0) continue;
    // A new instrument goes to the account's default portfolio; a difference
    // to the portfolio holding the most of it.
    const holding = holdingsView(next)
      .active.filter(
        (each) =>
          each.account.id === account.id &&
          each.holding.asset_class === "instrument" &&
          each.holding.instrument_symbol === row.symbol,
      )
      .sort((a, b) => compareDecimals(b.holding.amount, a.holding.amount))[0];
    const portfolioId = holding?.portfolio.id ?? account.portfolio.id;
    const quantity = order > 0 ? diff : minus("0", diff);
    const written = writeOperation(
      next,
      {
        kind: holding ? "adjustment" : "opening_balance",
        ...(holding && { direction: order > 0 ? "in" : "out" }),
        source_connection_id: account.id,
        instrument_symbol: row.symbol,
        date: item.documentDate ?? state.today,
        currency: row.currency,
        price: order > 0 ? (row.price ?? "0") : "0",
        parts: [{ portfolio_id: portfolioId, quantity }],
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
