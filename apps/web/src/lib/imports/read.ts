import "server-only";
import { unitPrice } from "@plant/core";
import { buenosAiresDate, type Database } from "@plant/shared";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { InstrumentRow } from "@/lib/holdings/read";
import {
  IMPORT_FAILURE_MESSAGES,
  type ImportItem,
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
  status: z.enum(["queued", "reading", "ready", "failed", "confirmed"]),
  failure: z
    .enum(["unsupported", "unreadable", "nothing_found", "extraction_failed"])
    .nullable(),
  document_date: z.string().nullable(),
  created_at: z.string(),
  document: z.object({
    file_name: z.string(),
    source_connection_id: z.string(),
  }),
});

// The user's latest imports, as Cargar lists them, and how many they started
// this month (in Buenos Aires).
export async function readImports(
  client: Client,
  today: string,
): Promise<{ items: ImportItem[]; used: number }> {
  const monthStart = `${today.slice(0, 7)}-01T00:00:00-03:00`;
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
    client
      .from("imports")
      .select("id", { count: "exact", head: true })
      .gte("created_at", monthStart),
  ]);
  const failure =
    classifyPostgrestResult(list, 200) ?? classifyPostgrestResult(month, 200);
  if (failure || !list.data || month.count === null) {
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
      createdOn: buenosAiresDate(new Date(row.created_at)),
    };
  });
  return { items, used: month.count };
}

const itemSchema = z.object({
  id: z.string(),
  symbol: z.string(),
  quantity: z.string(),
  price: z.string().nullable(),
  currency: z.enum(["ARS", "USD"]),
  confidence: z.enum(["high", "medium", "low"]),
  source_page: z.number().nullable(),
});

// A draft row as the review edits it. An instrument Plant knows keeps its
// symbol and its price per unit (a bond's document prints it per 100); one it
// does not know is left for the user to choose, with what the document named.
function reviewRow(
  data: unknown,
  instruments: ReadonlyMap<string, InstrumentRow>,
): ImportRow {
  const row = itemSchema.parse(data);
  const known = instruments.get(row.symbol.trim().toUpperCase());
  const page = row.source_page === null ? null : `Página ${row.source_page}`;
  const named = known ? null : `Leído como "${row.symbol}"`;
  return {
    id: row.id,
    symbol: known?.symbol ?? "",
    quantity: row.quantity,
    price:
      row.price === null
        ? null
        : known
          ? unitPrice(known.type, row.price)
          : row.price,
    currency: known?.currency ?? row.currency,
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
  const [found, items] = await Promise.all([
    client
      .from("imports")
      .select(
        "id, status, failure, document_date, created_at, " +
          "document:uploaded_documents!imports_user_id_document_id_fkey(file_name, source_connection_id)",
      )
      .eq("id", id)
      .limit(1),
    client
      .from("import_items")
      .select(
        "id, symbol, quantity:quantity::text, price:price::text, currency, confidence, source_page",
      )
      .eq("import_id", id)
      .order("position"),
  ]);
  const failure =
    classifyPostgrestResult(found, 200) ?? classifyPostgrestResult(items, 200);
  if (failure || !found.data || !items.data) {
    throw new ImportsReadError(failure?.code ?? "no_data");
  }
  const [data] = found.data as unknown[];
  if (data === undefined) return null;
  const row = rowSchema.parse(data);
  const bySymbol = new Map(instruments.map((each) => [each.symbol, each]));
  return {
    id: row.id,
    fileName: row.document.file_name,
    accountId: row.document.source_connection_id,
    status: row.status,
    error: row.failure && IMPORT_FAILURE_MESSAGES[row.failure],
    documentDate: row.document_date,
    documentTotals: [],
    rows: (items.data as unknown[]).map((each) => reviewRow(each, bySymbol)),
    createdOn: buenosAiresDate(new Date(row.created_at)),
  };
}
