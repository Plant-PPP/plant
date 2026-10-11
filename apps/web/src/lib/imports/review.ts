import {
  compareDecimals,
  type Currency,
  exactOf,
  plus,
  times,
  toDecimal,
} from "@plant/shared";

// Where an import stands: waiting, being read, read and waiting for the
// user's review, refused with a reason, or confirmed into the account.
export type ImportStatus =
  "queued" | "reading" | "ready" | "failed" | "confirmed";

export const IMPORT_STATUS_LABELS: Record<ImportStatus, string> = {
  queued: "En cola",
  reading: "Leyendo",
  ready: "Lista para revisar",
  failed: "Con error",
  confirmed: "Confirmada",
};

// How sure the reading is of a row; a low one is for the user to check.
export type Confidence = "high" | "medium" | "low";

export const CONFIDENCE_LABELS: Record<Confidence, string> = {
  high: "Alta",
  medium: "Media",
  low: "Baja",
};

// One holding as the document lists it: the instrument, how many, the price
// per unit in its currency, and where in the document it was read.
export type ImportRow = {
  id: string;
  symbol: string;
  quantity: string;
  price: string | null;
  currency: Currency;
  confidence: Confidence;
  source: string;
  discarded: boolean;
};

export type ImportItem = {
  id: string;
  fileName: string;
  accountId: string;
  status: ImportStatus;
  // Why a failed import was refused, in the user's words.
  error: string | null;
  // The statement's date and the totals it prints, per currency.
  documentDate: string | null;
  documentTotals: { currency: Currency; amount: string }[];
  rows: ImportRow[];
  createdOn: string;
};

// The most imports a month on the free plan.
export const IMPORTS_PER_MONTH = 10;

// What a row does to the account: a holding it does not have, more or fewer
// units than it has, the same, or nothing (discarded).
export type RowChange =
  | { kind: "new" }
  | { kind: "up" | "down"; held: string }
  | { kind: "same" }
  | { kind: "discarded" };

export function rowChange(
  row: Pick<ImportRow, "quantity" | "discarded">,
  held: string | undefined,
): RowChange {
  if (row.discarded) return { kind: "discarded" };
  if (held === undefined) return { kind: "new" };
  const order = compareDecimals(row.quantity, held);
  if (order === 0) return { kind: "same" };
  return { kind: order > 0 ? "up" : "down", held };
}

// What the rows read add up to, per currency: each row's quantity times its
// price. Rows discarded or without a price are left out.
export function readTotals(
  rows: readonly ImportRow[],
): { currency: Currency; amount: string }[] {
  const totals = new Map<Currency, ReturnType<typeof exactOf>>();
  for (const row of rows) {
    if (row.discarded || row.price === null) continue;
    const value = times(exactOf(row.quantity), exactOf(row.price));
    totals.set(
      row.currency,
      plus(totals.get(row.currency) ?? exactOf("0"), value),
    );
  }
  return [...totals].map(([currency, amount]) => ({
    currency,
    amount: toDecimal(amount, 2),
  }));
}

// Whether what was read matches the document's printed total in a currency,
// to the cent.
export const totalsMatch = (
  read: readonly { currency: Currency; amount: string }[],
  printed: readonly { currency: Currency; amount: string }[],
): boolean =>
  printed.every((total) => {
    const mine = read.find((each) => each.currency === total.currency);
    return (
      mine !== undefined && compareDecimals(mine.amount, total.amount) === 0
    );
  });
