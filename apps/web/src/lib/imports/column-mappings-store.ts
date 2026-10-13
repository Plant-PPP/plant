import "server-only";
import { createHash } from "node:crypto";

import type { Database } from "@plant/shared";
import type { SupabaseClient } from "@supabase/supabase-js";

import { classifyPostgrestResult } from "@/lib/supabase/postgrest-write";

type Client = SupabaseClient<Database>;
type Json =
  Database["public"]["Tables"]["column_mappings"]["Insert"]["mapping"];

// Where a spreadsheet format's column mapping is kept, per user, account
// institution and set of headers.
export type ColumnMappingsPort = {
  get(
    userId: string,
    institution: string,
    headers: readonly string[],
  ): Promise<unknown>;
  save(
    userId: string,
    institution: string,
    headers: readonly string[],
    mapping: Json,
  ): Promise<void>;
};

export class ColumnMappingsError extends Error {
  override readonly name = "ColumnMappingsError";
  constructor(
    readonly step: "get" | "save",
    readonly code: string,
  ) {
    super(`column mappings ${step} failed: ${code}`);
  }
}

// One set of headers exactly as the sheet has them, so a mapping found by it
// always names headers the sheet has.
export function headerSignature(headers: readonly string[]): string {
  return createHash("sha256").update(headers.join("\u001f")).digest("hex");
}

// The mappings over a service-role client: it bypasses RLS, so every call
// filters by the user.
export function createColumnMappingsStore(client: Client): ColumnMappingsPort {
  return {
    async get(userId, institution, headers) {
      const result = await client
        .from("column_mappings")
        .select("mapping")
        .eq("user_id", userId)
        .eq("institution", institution)
        .eq("header_signature", headerSignature(headers))
        .limit(1);
      const failure = classifyPostgrestResult(result, 200);
      if (failure) throw new ColumnMappingsError("get", failure.code);
      return result.data?.[0]?.mapping ?? null;
    },

    async save(userId, institution, headers, mapping) {
      const result = await client.from("column_mappings").upsert(
        {
          user_id: userId,
          institution,
          header_signature: headerSignature(headers),
          mapping,
        },
        {
          onConflict: "user_id,institution,header_signature",
          ignoreDuplicates: true,
        },
      );
      const failure = classifyPostgrestResult(result, 201);
      if (failure) throw new ColumnMappingsError("save", failure.code);
    },
  };
}
