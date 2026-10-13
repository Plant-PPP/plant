"use server";

import type { Database } from "@plant/shared";

import type { HoldingDeleteResult } from "@/lib/holdings/delete-result";

import {
  type HoldingInsert,
  type HoldingUpdate,
  holdingInsertSchema,
  holdingUpdateSchema,
} from "@/lib/holdings/schemas";
import {
  ownRow,
  restoreWrite,
  runArchive,
  runInsert,
  runUpdate,
} from "@/lib/portfolio-setup/run-write";
import { noInput } from "@/lib/portfolio-setup/schemas";
import type { WriteResult } from "@/lib/portfolio-setup/write-result";
import { deleteHoldingRow } from "@/lib/ledger/write";
import type { DecimalWrite } from "@/lib/supabase/decimal-columns";

// The arguments come from the browser and are parsed before any write. Updates
// filter by the session's user besides RLS and by the parsed id; an insert's
// user_id is the column default, which RLS checks, and the composite foreign
// keys keep its account and portfolio the user's.

type Tables = Database["public"]["Tables"];
type Amounts = "amount" | "annual_rate";
type Insert = Tables["holdings"]["Insert"];
type Update = Tables["holdings"]["Update"];
type KeysOf<T> = T extends unknown ? keyof T : never;

export async function createHolding(input: unknown): Promise<WriteResult> {
  return runInsert(
    {
      table: "holdings",
      action: "create_holding",
      schema: holdingInsertSchema,
      input,
    },
    ({ client, input }) => {
      // Amounts stay decimal strings; the cast is only for the generated types.
      const row = input satisfies DecimalWrite<
        Insert,
        Extract<KeysOf<HoldingInsert>, keyof Insert>,
        Amounts
      >;
      return client
        .from("holdings")
        .insert(row as unknown as Insert)
        .select("id");
    },
  );
}

// The class filters the row, so an edit never turns one class into another;
// one archived meanwhile is not_found.
export async function updateHolding(
  id: unknown,
  input: unknown,
): Promise<WriteResult> {
  return runUpdate(
    {
      table: "holdings",
      action: "update_holding",
      schema: holdingUpdateSchema,
      input,
    },
    id,
    (args) => {
      const { asset_class, ...columns } = args.input;
      const row = columns satisfies DecimalWrite<
        Update,
        Extract<Exclude<KeysOf<HoldingUpdate>, "asset_class">, keyof Update>,
        Amounts
      >;
      // ownRow's query is typed over every setup table, which share no
      // asset_class; the column is named as a plain string.
      return ownRow(args, "holdings", row as unknown as Update)
        .eq<string>("asset_class", asset_class)
        .is("archived_at", null)
        .select("id");
    },
  );
}

export async function archiveHolding(id: unknown): Promise<WriteResult> {
  return runArchive("holdings", "archive_holding", id);
}

export async function restoreHolding(id: unknown): Promise<WriteResult> {
  return runUpdate(
    {
      table: "holdings",
      action: "restore_holding",
      schema: noInput,
      input: {},
    },
    id,
    restoreWrite("holdings"),
  );
}

export async function deleteHolding(id: unknown): Promise<HoldingDeleteResult> {
  return deleteHoldingRow(id);
}
