"use server";

import { NAME_LIMITS } from "@/lib/portfolio-setup/limits";
import {
  runInsert,
  runUpdate,
  type UpdateArgs,
} from "@/lib/portfolio-setup/run-write";
import { nameInputSchema } from "@/lib/portfolio-setup/schemas";
import type { WriteResult } from "@/lib/portfolio-setup/write-result";
import { z } from "zod";

const portfolioName = nameInputSchema(NAME_LIMITS.portfolios.name);
const noInput = z.object({});

// The arguments come from the browser and are parsed before any write. Updates
// filter by the session's user besides RLS and by the parsed id; an insert's
// user_id is the column default, which RLS checks.

export async function createPortfolio(input: unknown): Promise<WriteResult> {
  return runInsert(
    { action: "create_portfolio", schema: portfolioName, input },
    ({ client, input }) =>
      client.from("portfolios").insert({ name: input.name }).select("id"),
  );
}

export async function renamePortfolio(
  id: unknown,
  input: unknown,
): Promise<WriteResult> {
  return runUpdate(
    { action: "rename_portfolio", schema: portfolioName, input },
    id,
    ({ client, userId, input, id }) =>
      client
        .from("portfolios")
        .update({ name: input.name })
        .eq("user_id", userId)
        .eq("id", id)
        .is("archived_at", null)
        .select("id"),
  );
}

// The trigger stamps the server's time; the value sent only says "archived".
export async function archivePortfolio(id: unknown): Promise<WriteResult> {
  return runUpdate(
    { action: "archive_portfolio", schema: noInput, input: {} },
    id,
    ({ client, userId, id }) =>
      client
        .from("portfolios")
        .update({ archived_at: new Date().toISOString() })
        .eq("user_id", userId)
        .eq("id", id)
        .is("archived_at", null)
        .select("id"),
  );
}

// With a name, renames and restores in one write, for a portfolio whose name
// an active one took while it was archived.
export async function restorePortfolio(
  id: unknown,
  input?: unknown,
): Promise<WriteResult> {
  const restore = ({
    client,
    userId,
    input,
    id,
  }: UpdateArgs<{ name?: string }>) =>
    client
      .from("portfolios")
      .update(
        input.name === undefined
          ? { archived_at: null }
          : { name: input.name, archived_at: null },
      )
      .eq("user_id", userId)
      .eq("id", id)
      .not("archived_at", "is", null)
      .select("id");
  return input === undefined
    ? runUpdate(
        { action: "restore_portfolio", schema: noInput, input: {} },
        id,
        restore,
      )
    : runUpdate(
        { action: "restore_rename_portfolio", schema: portfolioName, input },
        id,
        restore,
      );
}
