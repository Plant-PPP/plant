import type { ImportIssue } from "@plant/core";
import {
  compareDecimals,
  type Currency,
  type Database,
  exactOf,
  plus,
  times,
  toDecimal,
} from "@plant/shared";

// Where an import stands: waiting, being read, read and waiting for the
// user's review, refused with a reason, or confirmed into the account.
export type ImportStatus = Database["public"]["Enums"]["import_status"];

export const IMPORT_STATUS_LABELS: Record<ImportStatus, string> = {
  queued: "En cola",
  reading: "Leyendo",
  ready: "Lista para revisar",
  failed: "Con error",
  confirmed: "Confirmada",
};

export const isBusy = (status: ImportStatus): boolean =>
  status === "queued" || status === "reading";

// Why an import failed, in the user's words, by `imports.failure`.
export const IMPORT_FAILURE_MESSAGES = {
  unsupported: "No leemos este tipo de archivo.",
  unreadable: "No pudimos leer el archivo. Probá con otra copia o una captura.",
  nothing_found: "No encontramos tenencias ni operaciones en el archivo.",
  extraction_failed: "No pudimos leer el archivo. Probá de nuevo más tarde.",
} as const;

// How sure the reading is of a row; a low one is for the user to check.
export type Confidence = "high" | "medium" | "low";

export const CONFIDENCE_LABELS: Record<Confidence, string> = {
  high: "Alta",
  medium: "Media",
  low: "Baja",
};

// What a row's figures fail, in the user's words.
export const ISSUE_LABELS: Record<ImportIssue, string> = {
  value_mismatch: "El valor no coincide con cantidad × precio",
  duplicate_symbol: "Este instrumento aparece más de una vez",
};

// Why the statement's date looks wrong, in the user's words.
export const DATE_ISSUE_LABELS = {
  future: "La fecha del resumen es posterior a hoy.",
  old: "La fecha del resumen parece demasiado antigua.",
} as const;

// One holding as the document lists it: the instrument, how many, the price
// per unit in its currency, and where in the document it was read.
export type ImportRow = {
  id: string;
  symbol: string;
  quantity: string;
  price: string | null;
  // The row's value as the document prints it, in its currency; the
  // prototype's rows print none.
  value?: string | null;
  currency: Currency;
  confidence: Confidence;
  source: string;
  discarded: boolean;
  // Where a row that adds units sends them, as the review chose: the
  // portfolio a new instrument goes to, and the account they come from when
  // they are a transfer, not a purchase.
  portfolioId?: string;
  transferFrom?: string;
};

// The operations a document of operations may show.
export type ImportOperationKind = "purchase" | "sale" | "dividend" | "coupon";

// One operation as the document shows it, for the user to complete: every
// null (an empty symbol for the instrument) is something the document does
// not say or the readings disagreed on. The price is as printed, a bond's per
// 100 nominal; the charges are the operation's, added up.
export type ImportOperationRow = {
  id: string;
  date: string | null;
  kind: ImportOperationKind | null;
  symbol: string;
  quantity: string | null;
  price: string | null;
  amount: string | null;
  charges: string | null;
  reference: string | null;
  currency: Currency;
  confidence: Confidence;
  source: string;
  discarded: boolean;
  // Already in the account: it starts discarded.
  loaded?: boolean;
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
  // A document of operations' draft, instead of rows of holdings.
  operations?: ImportOperationRow[];
  // Holdings a spreadsheet lists that the reading left out.
  skippedRows: number;
  createdOn: string;
};

// The most imports a calendar month in Buenos Aires on the beta plan; the
// database refuses the next one (private.check_import_quota).
export const IMPORTS_PER_MONTH = 20;

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

// What the rows read add up to, per currency: each row's printed value, else
// its quantity times its price. Rows discarded or with neither are left out.
export function readTotals(
  rows: readonly ImportRow[],
): { currency: Currency; amount: string }[] {
  const totals = new Map<Currency, ReturnType<typeof exactOf>>();
  for (const row of rows) {
    if (row.discarded) continue;
    const printed = row.value ?? null;
    if (printed === null && row.price === null) continue;
    const value =
      printed !== null
        ? exactOf(printed)
        : times(exactOf(row.quantity), exactOf(row.price!));
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

// Whether what was read matches the totals the document prints, to the cent,
// currency by currency; "none" when there is nothing to compare: no printed
// total, or totals in other currencies than the rows read (one peso total
// over peso and dollar rows, or a dollar total over dollar lines left for the
// user to price).
export function totalsMatch(
  read: readonly { currency: Currency; amount: string }[],
  printed: readonly { currency: Currency; amount: string }[],
): boolean | "none" {
  if (printed.length === 0) return "none";
  const currencies = (list: typeof read) =>
    [...new Set(list.map(({ currency }) => currency))].sort().join();
  if (currencies(read) !== currencies(printed)) return "none";
  return printed.every((total) => {
    const mine = read.find((each) => each.currency === total.currency);
    return (
      mine !== undefined && compareDecimals(mine.amount, total.amount) === 0
    );
  });
}
