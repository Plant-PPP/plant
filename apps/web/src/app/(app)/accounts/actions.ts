"use server";

import { NAME_LIMITS } from "@/lib/portfolio-setup/limits";
import { namedRowWrites } from "@/lib/portfolio-setup/named-row-writes";
import {
  runArchive,
  runInsert,
  runUpdate,
} from "@/lib/portfolio-setup/run-write";
import {
  type SourceConnectionInput,
  sourceConnectionInputSchema,
} from "@/lib/portfolio-setup/schemas";
import type { WriteResult } from "@/lib/portfolio-setup/write-result";

// The arguments come from the browser and are parsed before any write. Updates
// filter by the session's user besides RLS and by the parsed id; an insert's
// user_id is the column default, which RLS checks.

const portfolios = namedRowWrites("portfolios", "portfolio");
const holders = namedRowWrites("holders", "holder");

export async function createPortfolio(input: unknown): Promise<WriteResult> {
  return portfolios.create(input);
}

export async function renamePortfolio(
  id: unknown,
  input: unknown,
): Promise<WriteResult> {
  return portfolios.rename(id, input);
}

export async function archivePortfolio(id: unknown): Promise<WriteResult> {
  return portfolios.archive(id);
}

export async function restorePortfolio(
  id: unknown,
  input?: unknown,
): Promise<WriteResult> {
  return portfolios.restore(id, input);
}

export async function createHolder(input: unknown): Promise<WriteResult> {
  return holders.create(input);
}

export async function renameHolder(
  id: unknown,
  input: unknown,
): Promise<WriteResult> {
  return holders.rename(id, input);
}

export async function archiveHolder(id: unknown): Promise<WriteResult> {
  return holders.archive(id);
}

export async function restoreHolder(
  id: unknown,
  input?: unknown,
): Promise<WriteResult> {
  return holders.restore(id, input);
}

const sourceConnection = sourceConnectionInputSchema(
  NAME_LIMITS.source_connections.institution,
);

function sourceConnectionRow(input: SourceConnectionInput) {
  return {
    institution: input.institution,
    holder_id: input.holder === "self" ? null : input.holder,
    include_in_tax_report: input.includeInTaxReport,
    default_portfolio_id: input.defaultPortfolioId,
  };
}

export async function createSourceConnection(
  input: unknown,
): Promise<WriteResult> {
  return runInsert(
    { action: "create_source_connection", schema: sourceConnection, input },
    ({ client, input }) =>
      client
        .from("source_connections")
        .insert(sourceConnectionRow(input))
        .select("id"),
  );
}

// Only an active account is edited, so one archived meanwhile is not_found.
export async function updateSourceConnection(
  id: unknown,
  input: unknown,
): Promise<WriteResult> {
  return runUpdate(
    { action: "update_source_connection", schema: sourceConnection, input },
    id,
    ({ client, userId, input, id }) =>
      client
        .from("source_connections")
        .update(sourceConnectionRow(input))
        .eq("user_id", userId)
        .eq("id", id)
        .is("archived_at", null)
        .select("id"),
  );
}

export async function archiveSourceConnection(
  id: unknown,
): Promise<WriteResult> {
  return runArchive("source_connections", "archive_source_connection", id);
}

// Restores with the fields the user confirmed in one write, since its holder
// or portfolio may have been archived meanwhile.
export async function restoreSourceConnection(
  id: unknown,
  input: unknown,
): Promise<WriteResult> {
  return runUpdate(
    { action: "restore_source_connection", schema: sourceConnection, input },
    id,
    ({ client, userId, input, id }) =>
      client
        .from("source_connections")
        .update({ ...sourceConnectionRow(input), archived_at: null })
        .eq("user_id", userId)
        .eq("id", id)
        .not("archived_at", "is", null)
        .select("id"),
  );
}
