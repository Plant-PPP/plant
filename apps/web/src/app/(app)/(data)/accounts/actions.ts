"use server";

import { revalidatePath } from "next/cache";
import { removeAccountUploads } from "@/lib/portfolio-setup/account-uploads";
import {
  activeWrite,
  restoreWrite,
  runArchive,
  runDelete,
  runInsert,
  runUpdate,
} from "@/lib/portfolio-setup/run-write";
import {
  noInput,
  type PortfolioInput,
  portfolioInputSchema,
  type SourceConnectionInput,
  sourceConnectionInputSchema,
} from "@/lib/portfolio-setup/schemas";
import type { WriteResult } from "@/lib/portfolio-setup/write-result";

// The arguments come from the browser and are parsed before any write. Updates
// filter by the session's user besides RLS and by the parsed id; an insert's
// user_id is the column default, which RLS checks.

export async function createPortfolio(input: unknown): Promise<WriteResult> {
  return runInsert(
    {
      table: "portfolios",
      action: "create_portfolio",
      schema: portfolioInputSchema,
      input,
    },
    ({ client, input }) =>
      client.from("portfolios").insert({ name: input.name }).select("id"),
  );
}

export async function renamePortfolio(
  id: unknown,
  input: unknown,
): Promise<WriteResult> {
  return runUpdate(
    {
      table: "portfolios",
      action: "rename_portfolio",
      schema: portfolioInputSchema,
      input,
    },
    id,
    activeWrite("portfolios", (input: PortfolioInput) => ({
      name: input.name,
    })),
  );
}

export async function archivePortfolio(id: unknown): Promise<WriteResult> {
  return runArchive("portfolios", "archive_portfolio", id);
}

// Only a portfolio nothing ever used; the guard refuses the rest.
export async function deletePortfolio(id: unknown): Promise<WriteResult> {
  return runDelete("portfolios", "delete_portfolio", id);
}

const restorePortfolioRow = restoreWrite(
  "portfolios",
  (input: Partial<PortfolioInput>) =>
    input.name === undefined ? {} : { name: input.name },
);

// With a name, renames and restores in one write, for a portfolio whose name
// an active one took while it was archived.
export async function restorePortfolio(
  id: unknown,
  input?: unknown,
): Promise<WriteResult> {
  return input === undefined
    ? runUpdate(
        {
          table: "portfolios",
          action: "restore_portfolio",
          schema: noInput,
          input: {},
        },
        id,
        restorePortfolioRow,
      )
    : runUpdate(
        {
          table: "portfolios",
          action: "restore_rename_portfolio",
          schema: portfolioInputSchema,
          input,
        },
        id,
        restorePortfolioRow,
      );
}

function sourceConnectionRow(input: SourceConnectionInput) {
  return {
    institution: input.institution,
    include_in_tax_report: input.includeInTaxReport,
    default_portfolio_id: input.defaultPortfolioId,
  };
}

export async function createSourceConnection(
  input: unknown,
): Promise<WriteResult> {
  return runInsert(
    {
      table: "source_connections",
      action: "create_source_connection",
      schema: sourceConnectionInputSchema,
      input,
    },
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
    {
      table: "source_connections",
      action: "update_source_connection",
      schema: sourceConnectionInputSchema,
      input,
    },
    id,
    activeWrite("source_connections", sourceConnectionRow),
  );
}

export async function archiveSourceConnection(
  id: unknown,
): Promise<WriteResult> {
  return runArchive("source_connections", "archive_source_connection", id);
}

// Restores with the fields the user confirmed in one write, since its
// portfolio may have been archived meanwhile.
export async function restoreSourceConnection(
  id: unknown,
  input: unknown,
): Promise<WriteResult> {
  return runUpdate(
    {
      table: "source_connections",
      action: "restore_source_connection",
      schema: sourceConnectionInputSchema,
      input,
    },
    id,
    restoreWrite("source_connections", sourceConnectionRow),
  );
}

// Only an account no holding ever sat in. Its uploads go with it, their files
// first.
export async function deleteSourceConnection(
  id: unknown,
): Promise<WriteResult> {
  const result = await runDelete(
    "source_connections",
    "delete_source_connection",
    id,
    removeAccountUploads,
  );
  if (result.ok) revalidatePath("/import");
  return result;
}
