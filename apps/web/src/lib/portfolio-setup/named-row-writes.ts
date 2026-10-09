import "server-only";
import { NAME_LIMITS } from "./limits";
import { runArchive, runInsert, runUpdate, type UpdateArgs } from "./run-write";
import { nameInputSchema, noInput } from "./schemas";
import type { WriteResult } from "./write-result";

// The writes of a table whose rows are a name the user archives and restores:
// portfolios and holders. The table is fixed by the server action that calls
// it, never chosen by the browser.
// The singular in each write's logged action name.
const NOUNS = { portfolios: "portfolio", holders: "holder" } as const;

export function namedRowWrites(table: keyof typeof NOUNS) {
  const noun = NOUNS[table];
  const schema = nameInputSchema(NAME_LIMITS[table].name);

  const restore = ({
    client,
    userId,
    input,
    id,
  }: UpdateArgs<{ name?: string }>) =>
    client
      .from(table)
      .update(
        input.name === undefined
          ? { archived_at: null }
          : { name: input.name, archived_at: null },
      )
      .eq("user_id", userId)
      .eq("id", id)
      .not("archived_at", "is", null)
      .select("id");

  return {
    create: (input: unknown): Promise<WriteResult> =>
      runInsert(
        { action: `create_${noun}`, schema, input },
        ({ client, input }) =>
          client.from(table).insert({ name: input.name }).select("id"),
      ),

    rename: (id: unknown, input: unknown): Promise<WriteResult> =>
      runUpdate(
        { action: `rename_${noun}`, schema, input },
        id,
        ({ client, userId, input, id }) =>
          client
            .from(table)
            .update({ name: input.name })
            .eq("user_id", userId)
            .eq("id", id)
            .is("archived_at", null)
            .select("id"),
      ),

    archive: (id: unknown): Promise<WriteResult> =>
      runArchive(table, `archive_${noun}`, id),

    // With a name, renames and restores in one write, for a row whose name an
    // active one took while it was archived.
    restore: (id: unknown, input?: unknown): Promise<WriteResult> =>
      input === undefined
        ? runUpdate(
            { action: `restore_${noun}`, schema: noInput, input: {} },
            id,
            restore,
          )
        : runUpdate(
            { action: `restore_rename_${noun}`, schema, input },
            id,
            restore,
          ),
  };
}
