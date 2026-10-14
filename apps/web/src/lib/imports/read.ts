import "server-only";
import {
  type InstrumentType,
  quotedPrice,
  normalizeSymbol,
  instrumentIndex,
  resolveSymbol,
  unitPrice,
} from "@plant/core";
import {
  buenosAiresDate,
  compareExact,
  Constants,
  type Database,
  exactOf,
  over,
  stored,
} from "@plant/shared";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { InstrumentRow } from "@/lib/holdings/read";
import {
  IMPORT_FAILURE_MESSAGES,
  type ImportItem,
  type ImportOperationRow,
  type ImportRow,
} from "@/lib/imports/review";
import { classifyPostgrestResult } from "@/lib/supabase/postgrest-write";

type Client = SupabaseClient<Database>;

export const IMPORTS_VIEW_EVENT = "imports.view";

// The most imports Cargar lists, newest first.
export const IMPORTS_LISTED = 50;

export class ImportsReadError extends Error {
  constructor(readonly code: string) {
    super(`imports read failed: ${code}`);
  }
}

const rowSchema = z.object({
  id: z.string(),
  status: z.enum(Constants.public.Enums.import_status),
  failure: z.enum(Constants.public.Enums.import_failure).nullable(),
  document_date: z.string().nullable(),
  created_at: z.string(),
  document: z.object({
    file_name: z.string(),
    source_connection_id: z.string(),
  }),
});

// The user's latest imports, as Cargar lists them, and how many they started
// this month (in Buenos Aires), deleted ones included.
export async function readImports(
  client: Client,
): Promise<{ items: ImportItem[]; used: number }> {
  const [list, month] = await Promise.all([
    client
      .from("imports")
      .select(
        "id, status, failure, document_date, created_at, " +
          "document:uploaded_documents!imports_user_id_document_id_fkey(file_name, source_connection_id)",
      )
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(IMPORTS_LISTED),
    client.rpc("imports_used_this_month"),
  ]);
  const failure =
    classifyPostgrestResult(list, 200) ?? classifyPostgrestResult(month, 200);
  if (failure || !list.data || typeof month.data !== "number") {
    throw new ImportsReadError(failure?.code ?? "no_data");
  }
  const items = (list.data as unknown[]).map((data): ImportItem => {
    const row = rowSchema.parse(data);
    return {
      id: row.id,
      fileName: row.document.file_name,
      accountId: row.document.source_connection_id,
      status: row.status,
      error: row.failure && IMPORT_FAILURE_MESSAGES[row.failure],
      documentDate: row.document_date,
      documentTotals: [],
      rows: [],
      skippedRows: 0,
      createdOn: buenosAiresDate(new Date(row.created_at)),
    };
  });
  return { items, used: month.data };
}

const itemSchema = z.object({
  id: z.string(),
  symbol: z.string(),
  quantity: z.string(),
  price: z.string().nullable(),
  value: z.string().nullable(),
  cost: z.string().nullable().optional(),
  account: z.string().nullable().optional(),
  currency: z.enum(Constants.public.Enums.currency),
  confidence: z.enum(Constants.public.Enums.import_confidence),
  source_page: z.number().nullable(),
});

const operationSchema = z.object({
  id: z.string(),
  date: z.string().nullable(),
  kind: z.enum(["purchase", "sale", "dividend", "coupon"]).nullable(),
  symbol: z.string().nullable(),
  quantity: z.string().nullable(),
  price: z.string().nullable(),
  amount: z.string().nullable(),
  charges: z.string().nullable(),
  reference: z.string().nullable(),
  currency: z.enum(Constants.public.Enums.currency),
  confidence: z.enum(Constants.public.Enums.import_confidence),
  source_page: z.number().nullable(),
});

// Whether the document names an instrument by its D (MEP) or C (cable) line.
const isDollarLine = (printed: string, symbol: string) => {
  const key = normalizeSymbol(printed.trim().replace(/\.BA$/i, ""));
  return /[DC]$/.test(key) && key.slice(0, -1) === normalizeSymbol(symbol);
};

// An operation as the review completes it. An instrument Plant knows keeps
// its symbol; one it does not, or none named, is left for the user to choose,
// with what the document called it. The currency is the operation's own: a
// dollar line of AL30 (AL30D) is a dollar trade of AL30. The price stays as
// printed until the instrument is known.
function reviewOperation(
  data: unknown,
  index: ReturnType<typeof instrumentIndex>,
): ImportOperationRow {
  const row = operationSchema.parse(data);
  const known = row.symbol === null ? null : resolveSymbol(row.symbol, index);
  const page = row.source_page === null ? null : `Página ${row.source_page}`;
  const named =
    row.symbol === null
      ? "El documento no dice qué activo es"
      : known && known.symbol === row.symbol.trim().toUpperCase()
        ? null
        : `Leído como "${row.symbol}"`;
  return {
    id: row.id,
    date: row.date,
    kind: row.kind,
    symbol: known?.symbol ?? "",
    quantity: row.quantity,
    price: row.price,
    amount: row.amount,
    charges: row.charges,
    reference: row.reference?.trim() || null,
    // A dollar line (AL30D, GD30C) is a dollar trade, whatever currency was
    // read.
    currency:
      known && isDollarLine(row.symbol!, known.symbol) ? "USD" : row.currency,
    confidence: row.confidence,
    source: [page, named].filter(Boolean).join(" · ") || "Del documento",
    discarded: false,
  };
}

const totalsSchema = z.object({
  printed_total_ars: z.string().nullable(),
  printed_total_usd: z.string().nullable(),
  skipped_rows: z.number().int().nonnegative(),
});

// Whether a printed cost reads as one unit's: within ten times either way of
// the price or of the value per unit, when the row prints either. A column
// of total costs taken for unit costs is left out rather than proposed.
function isUnitCost(
  row: z.infer<typeof itemSchema>,
  type: InstrumentType | undefined,
): boolean {
  const cost = exactOf(row.cost!);
  // The printed cost and price are on the quote's basis (a bond's per 100);
  // the value per unit is on one unit's.
  const perUnit =
    row.price !== null
      ? exactOf(row.price)
      : row.value !== null
        ? exactOf(
            quotedPrice(
              type ?? "cedear",
              stored(over(exactOf(row.value), exactOf(row.quantity))),
            ),
          )
        : null;
  if (perUnit === null) return true;
  const ratio = over(cost, perUnit);
  return (
    compareExact(ratio, exactOf("0.1")) >= 0 &&
    compareExact(ratio, exactOf("10")) <= 0
  );
}

// A draft row as the review edits it. An instrument Plant knows keeps its
// symbol and its price per unit (a bond's document prints it per 100); one it
// does not know is left for the user to choose, with what the document named.
// A line in another currency than the instrument's (AL30D, a dollar line of
// AL30, or a peso instrument the document prices in dollars) leaves its price
// and value for the user, so no dollar price is ever written as a peso one.
function reviewRow(
  data: unknown,
  index: ReturnType<typeof instrumentIndex>,
): ImportRow {
  const row = itemSchema.parse(data);
  const known = resolveSymbol(row.symbol, index);
  const page = row.source_page === null ? null : `Página ${row.source_page}`;
  const named =
    known && known.symbol === row.symbol.trim().toUpperCase()
      ? null
      : `Leído como "${row.symbol}"`;
  const sameCurrency =
    !known ||
    (known.currency === known.instrumentCurrency &&
      row.currency === known.instrumentCurrency);
  return {
    id: row.id,
    symbol: known?.symbol ?? "",
    quantity: row.quantity,
    price:
      row.price === null || !sameCurrency
        ? null
        : known
          ? unitPrice(known.type, row.price)
          : row.price,
    value: sameCurrency ? row.value : null,
    ...(row.account != null && { accountLabel: row.account }),
    ...(row.cost != null &&
      sameCurrency &&
      isUnitCost(row, known?.type) && {
        cost: known ? unitPrice(known.type, row.cost) : row.cost,
      }),
    currency: known?.instrumentCurrency ?? row.currency,
    confidence: row.confidence,
    source: [page, named].filter(Boolean).join(" · ") || "Del documento",
    discarded: false,
  };
}

// One of the user's imports with its draft, for its review; null when it is
// not theirs. `instruments` are the ones a row may be.
export async function readImportForReview(
  client: Client,
  id: string,
  instruments: readonly InstrumentRow[],
): Promise<ImportItem | null> {
  const [found, items, operations] = await Promise.all([
    client
      .from("imports")
      .select(
        "id, status, failure, document_date, created_at, " +
          "printed_total_ars:printed_total_ars::text, printed_total_usd:printed_total_usd::text, skipped_rows, " +
          "document:uploaded_documents!imports_user_id_document_id_fkey(file_name, source_connection_id)",
      )
      .eq("id", id)
      .limit(1),
    client
      .from("import_items")
      .select(
        "id, symbol, quantity:quantity::text, price:price::text, value:value::text, cost:cost::text, account, " +
          "currency, confidence, source_page",
      )
      .eq("import_id", id)
      .order("position"),
    client
      .from("import_operations")
      .select(
        "id, date, kind, symbol, quantity:quantity::text, price:price::text, " +
          "amount:amount::text, charges:charges::text, reference, currency, " +
          "confidence, source_page",
      )
      .eq("import_id", id)
      .order("position"),
  ]);
  const failure =
    classifyPostgrestResult(found, 200) ??
    classifyPostgrestResult(items, 200) ??
    classifyPostgrestResult(operations, 200);
  if (failure || !found.data || !items.data || !operations.data) {
    throw new ImportsReadError(failure?.code ?? "no_data");
  }
  const [data] = found.data as unknown[];
  if (data === undefined) return null;
  const row = rowSchema.parse(data);
  const printed = totalsSchema.parse(data);
  const index = instrumentIndex(
    instruments.map((each) => ({ ...each, aliases: each.aliases ?? [] })),
  );
  return {
    id: row.id,
    fileName: row.document.file_name,
    accountId: row.document.source_connection_id,
    status: row.status,
    error: row.failure && IMPORT_FAILURE_MESSAGES[row.failure],
    documentDate: row.document_date,
    documentTotals: [
      { currency: "ARS" as const, amount: printed.printed_total_ars },
      { currency: "USD" as const, amount: printed.printed_total_usd },
    ].flatMap(({ currency, amount }) =>
      amount === null ? [] : [{ currency, amount }],
    ),
    rows: (items.data as unknown[]).map((each) => reviewRow(each, index)),
    ...(operations.data.length > 0 && {
      operations: (operations.data as unknown[]).map((each) =>
        reviewOperation(each, index),
      ),
    }),
    skippedRows: printed.skipped_rows,
    createdOn: buenosAiresDate(new Date(row.created_at)),
  };
}
