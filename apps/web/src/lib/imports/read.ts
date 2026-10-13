import "server-only";
import { buenosAiresDate, type Database } from "@plant/shared";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { ImportItem } from "@/lib/imports/review";
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
        "id, status, created_at, " +
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
      error: null,
      documentDate: null,
      documentTotals: [],
      rows: [],
      createdOn: buenosAiresDate(new Date(row.created_at)),
    };
  });
  return { items, used: month.count };
}
