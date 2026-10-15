import { compareDecimals, exactOf, plus, stored } from "@plant/shared";
import { z } from "zod";

import type { MovementResult } from "@/lib/holdings/movements-input";
import { heldOn, writeImport } from "@/lib/imports/confirm";
import {
  type ImportItem,
  type ImportRow,
  readTotals,
} from "@/lib/imports/review";

import {
  difference,
  priceToday,
  type PrototypeState,
  type Write,
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
  }: { id: string; fileName: string; accountId: string | null },
): Write<{ ok: true; id: string }> {
  const item: ImportItem = {
    id,
    fileName,
    accountId,
    status: "queued",
    error: null,
    documentDate: null,
    documentTotals: [],
    skippedRows: 0,
    origin: "document",
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
  // Made-up holdings are the account's, so a file uploaded to no account
  // reads none.
  const held =
    item.accountId === null
      ? new Map<string, string>()
      : heldOn(state, item.accountId, documentDate);
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
    skippedRows: 0,
    rows,
  }));
}

// Writes the reviewed rows into the account and marks the import confirmed.
export function confirmImport(
  state: PrototypeState,
  id: string,
  rows: readonly ImportRow[],
  newId: () => string,
): Write<MovementResult> {
  const item = state.imports.find((each) => each.id === id);
  if (!item || item.status !== "ready" || item.accountId === null) {
    return { state, result: { ok: false, code: "not_found" } };
  }
  const written = writeImport(
    state,
    {
      id,
      accountId: item.accountId,
      date: item.documentDate ?? state.today,
      fileName: item.fileName,
    },
    rows,
    newId,
  );
  if (!written.result.ok) return { state, result: written.result };
  return {
    state: withImport(written.state, id, (each) => ({
      ...each,
      status: "confirmed",
      rows: [...rows],
    })),
    result: written.result,
  };
}
