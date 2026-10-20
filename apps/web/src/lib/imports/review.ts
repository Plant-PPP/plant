import { PDF_PAGE_LIMIT } from "@plant/sources";
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

// What an import reads: an account's sync, a spreadsheet parsed in code, or a
// document or picture the model reads.
export type ImportOrigin = "sync" | "sheet" | "document";

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
  too_many_pages: `El PDF tiene más de ${PDF_PAGE_LIMIT} páginas. Subí solo las del resumen.`,
  connection_rejected:
    "El proveedor rechazó la conexión. Revisá que siga activa o conectala de nuevo.",
  connection_not_read_only:
    "La clave puede operar, retirar o transferir. Conectá una de solo lectura.",
} as const;

// A sync reads a connected account, not a file: its own words where they
// differ, naming its provider.
const SYNC_FAILURE_MESSAGES: Partial<
  Record<keyof typeof IMPORT_FAILURE_MESSAGES, (provider: string) => string>
> = {
  nothing_found: () =>
    "No encontramos saldos ni operaciones en la cuenta conectada.",
  unsupported: (provider) =>
    `${provider} no tiene activado el reporte que leemos. Seguí los pasos de la ayuda de la conexión y sincronizá de nuevo.`,
  extraction_failed: () =>
    "No pudimos leer la cuenta conectada. Probá de nuevo más tarde.",
  connection_rejected: (provider) =>
    `${provider} rechazó la conexión. Revisá que siga activa o conectala de nuevo.`,
};

// Why a failed import stopped, in the user's words: a sync's, by the name of
// the provider it reads (`provider`), else a file's.
export function importFailureMessage(
  failure: keyof typeof IMPORT_FAILURE_MESSAGES,
  provider: string | null,
): string {
  const sync = SYNC_FAILURE_MESSAGES[failure];
  return provider !== null && sync
    ? sync(provider)
    : IMPORT_FAILURE_MESSAGES[failure];
}

// A failed sync with no failure: the user started another while it was
// still queued.
export const SUPERSEDED_SYNC_MESSAGE =
  "La reemplazaste por otra sincronización.";

// How sure the reading is of a row; a low one is for the user to check.
export type Confidence = "high" | "medium" | "low";

export const CONFIDENCE_LABELS: Record<Confidence, string> = {
  high: "Alta",
  medium: "Media",
  low: "Baja",
};

// What a row's figures fail, in the user's words.
const ISSUE_LABELS: Record<ImportIssue, string> = {
  value_mismatch: "El valor no coincide con cantidad × precio",
  duplicate_symbol: "Este instrumento aparece más de una vez",
};

// A row's issue in the user's words, a cash balance's in its own.
export const issueLabel = (issue: ImportIssue, cash: boolean): string =>
  cash && issue === "duplicate_symbol"
    ? "Este saldo aparece más de una vez"
    : ISSUE_LABELS[issue];

// What a file import read, as the review names it.
export const fileNoun = (origin: ImportOrigin): string =>
  origin === "sheet" ? "la planilla" : "el documento";

// What a field the import did not bring says.
export const missingText = (origin: ImportOrigin): string =>
  origin === "sync"
    ? "No vino en la sincronización"
    : `Falta en ${fileNoun(origin)}`;

// Why a field the review needs is empty, given what the import brought:
// never brought by it, or cleared by the user.
export const lackingField = (
  draft: string | null,
  origin: ImportOrigin,
): string => (draft === null ? missingText(origin) : "Completá este dato");

// Why an operation's date is not accepted: later than today, or lacking.
export const lackingDate = (
  date: string | null,
  draft: string | null,
  origin: ImportOrigin,
  today: string,
): string =>
  date !== null && date > today
    ? "La fecha es posterior a hoy"
    : lackingField(draft, origin);

// The toast after confirming `what` of an import into the account named
// `institution`: a sync's by the account alone, a file's by the file too.
export const savedToast = (
  what: string,
  item: Pick<ImportItem, "origin" | "fileName">,
  institution: string,
): string =>
  item.origin === "sync"
    ? `Guardaste ${what} de ${institution}`
    : `Guardaste ${what} de ${item.fileName} en ${institution}`;

const ABOVE_ZERO = {
  quantity: "Ingresá una cantidad mayor a 0",
  price: "Ingresá un precio mayor a 0",
  amount: "Ingresá un monto mayor a 0",
} as const;

// Why a figure the review needs is lacking, given its text, which reads as a
// number when not empty: typed at 0 or below, cleared by the user, or never
// brought by the import.
export function lackingFigure(
  text: string,
  draft: string | null,
  origin: ImportOrigin,
  figure: keyof typeof ABOVE_ZERO,
): string {
  if (text.trim() !== "") return ABOVE_ZERO[figure];
  return lackingField(draft, origin);
}

// Why the statement's date looks wrong, in the user's words.
export const DATE_ISSUE_LABELS = {
  future: "La fecha del resumen es posterior a hoy.",
  old: "La fecha del resumen parece demasiado antigua.",
} as const;

// One holding as the document lists it: the instrument, how many, the price
// per unit in its currency, and where in the document it was read.
export type ImportRow = {
  id: string;
  // A cash balance: its symbol is its currency's code, its quantity the
  // amount, and it has no price. A row without it is an instrument.
  assetClass?: "cash";
  symbol: string;
  quantity: string;
  price: string | null;
  // The row's value as the document prints it, in its currency; the
  // prototype's rows print none.
  value?: string | null;
  // The cost of one unit the units came in at, in its currency: the average
  // cost the document prints, else the price.
  cost?: string | null;
  currency: Currency;
  confidence: Confidence;
  source: string;
  discarded: boolean;
  // Where a row that adds units sends them, as the review chose: the
  // portfolio a new instrument goes to, and the account they come from when
  // they are a transfer, not a purchase.
  portfolioId?: string;
  transferFrom?: string;
  // The account a document listing several names the row under, as printed,
  // and the user's account the review routes it to; the import's otherwise.
  accountLabel?: string;
  accountId?: string;
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
  // What the document called an instrument Plant does not know.
  unknownSymbol?: string;
};

// What a card statement says is owed in one currency, as the review shows
// it: null where the statement does not print it or the readings disagreed.
export type ImportDebtRow = {
  id: string;
  label: string | null;
  lender: string | null;
  currency: Currency;
  balance: string | null;
  minimumPayment: string | null;
  dueDate: string | null;
  confidence: Confidence;
  source: string;
  discarded: boolean;
};

export type ImportItem = {
  id: string;
  fileName: string;
  // None for a file uploaded to no account, until its review sets one.
  accountId: string | null;
  status: ImportStatus;
  // Why a failed import was refused, in the user's words.
  error: string | null;
  // The statement's date and the totals it prints, per currency.
  documentDate: string | null;
  documentTotals: { currency: Currency; amount: string }[];
  rows: ImportRow[];
  // A document of operations' draft, instead of rows of holdings.
  operations?: ImportOperationRow[];
  // A card statement's draft, when it is one.
  debts?: ImportDebtRow[];
  // Holdings, operations or debts the reading left out.
  skippedRows: number;
  // The movements of the account's cash a sync read, which confirming adds.
  cashMovements?: number;
  origin: ImportOrigin;
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

// What the rows read add up to, per currency: cash's amount, each other
// row's printed value, else its quantity times its price. Rows discarded or
// with neither are left out.
export function readTotals(
  rows: readonly ImportRow[],
): { currency: Currency; amount: string }[] {
  const totals = new Map<Currency, ReturnType<typeof exactOf>>();
  for (const row of rows) {
    if (row.discarded) continue;
    const printed =
      row.assetClass === "cash" ? row.quantity : (row.value ?? null);
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
