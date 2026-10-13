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
import {
  type ImportItem,
  type ImportRow,
  readTotals,
} from "@/lib/imports/review";

import {
  allRows,
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
    state: {
      ...state,
      imports: [item, ...state.imports],
      uploadedOn: [...state.uploadedOn, state.today],
    },
    result: { ok: true, id },
  };
}

export const startReading = (state: PrototypeState, id: string) =>
  withImport(state, id, (item) => ({ ...item, status: "reading" }));

// The account's open instrument holdings, largest first.
function heldHoldings(state: PrototypeState, accountId: string) {
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
  state: PrototypeState,
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
function holdingsOn(state: PrototypeState, accountId: string, date: string) {
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

// The date a statement is as of: the first YYYY-MM-DD in its file's name
// that is not after today, standing in for the date a real reading prints;
// else today.
export function documentDateOf(fileName: string, today: string): string {
  const named = /(\d{4}-\d{2}-\d{2})/.exec(fileName)?.[1];
  return named !== undefined &&
    named <= today &&
    z.iso.date().safeParse(named).success
    ? named
    : today;
}

// Each instrument the account holds, summed across its portfolios.
export function heldIn(
  state: PrototypeState,
  accountId: string,
): Map<string, string> {
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
  state: PrototypeState,
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
  const documentDate = documentDateOf(item.fileName, state.today);
  const held = heldOn(state, item.accountId, documentDate);
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
  // One the account could hold: a type it already has in that currency.
  const kindOf = (each: { type: string; currency: string }) =>
    `${each.type}:${each.currency}`;
  const kinds = new Set(symbols.map((symbol) => kindOf(instrumentOf(symbol))));
  const extra = state.instruments.find(
    (each) =>
      !held.has(each.symbol) &&
      kinds.has(kindOf(each)) &&
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
  // The last held row with a price read with a digit missing: a row with no
  // price leaves the totals as printed. With no such row, or one under 10
  // units, the reading has no misread row.
  const misread = truth
    .slice(0, symbols.length)
    .filter((row) => row.price !== null)
    .at(-1);
  const rows = truth.map((row) =>
    row.id === misread?.id && compareDecimals(row.quantity, "10") >= 0
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
    documentDate,
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
    portfolioId: z.string().min(1).optional(),
    transferFrom: z.string().min(1).optional(),
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
  // Each row is weighed against what the account held at the end of the
  // statement's day, and the difference is booked on that day. A later sale
  // that needs the units, a portfolio archived since or a holding that opens
  // later refuses the write, as it would refuse a movement typed by hand.
  const date = item.documentDate ?? state.today;
  const held = heldOn(state, account.id, date);
  for (const row of kept) {
    const instrument = state.instruments.find(
      (each) => each.symbol === row.symbol,
    );
    if (!instrument) return { state, result: { ok: false, code: "not_found" } };
    const diff = difference(row.quantity, held.get(row.symbol) ?? "0");
    const order = compareDecimals(diff, "0");
    if (order === 0) continue;
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
        return { state, result: { ok: false, code: "not_found" } };
      }
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
          operationId: newId(),
          newId,
          origin: { kind: "import", fileName: item.fileName, date },
        },
      );
      if (!moved.result.ok) return { state, result: moved.result };
      next = moved.state;
      continue;
    }
    let parts: { portfolio_id: string; quantity: string }[];
    if (order > 0) {
      if (row.price === null || compareDecimals(row.price, "0") <= 0) {
        return { state, result: { ok: false, code: "invalid" } };
      }
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
      {
        operationId: newId(),
        newId,
        origin: { kind: "import", fileName: item.fileName, date },
      },
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
