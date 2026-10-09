import {
  PORTFOLIO_SETUP_GUARD,
  type PortfolioSetupGuardHint,
} from "@plant/shared";
import { type Insert, expectError, rest } from "./pentest-helpers";
import type { TestUser } from "./pentest-users";

type SetupTable = "portfolios" | "holders" | "source_connections";

export async function createRow<T extends SetupTable>(
  user: TestUser,
  table: T,
  body: Insert<T>,
): Promise<string> {
  const res = await rest(user, "POST", table, {
    body,
    headers: { Prefer: "return=representation" },
  });
  expect(res.status).toBe(201);
  const [row] = res.body as { id: string }[];
  return row!.id;
}

export async function archiveRow(
  user: TestUser,
  table: SetupTable,
  id: string,
): Promise<void> {
  const res = await rest(user, "PATCH", `${table}?id=eq.${id}`, {
    body: { archived_at: new Date().toISOString() },
  });
  expect(res.status).toBe(204);
}

// The portfolio signup created.
export async function principalOf(user: TestUser): Promise<string> {
  const res = await rest(
    user,
    "GET",
    `portfolios?user_id=eq.${user.id}&name=eq.Principal&select=id`,
  );
  expect(res.status).toBe(200);
  const [row] = res.body as { id: string }[];
  expect(row).toBeDefined();
  return row!.id;
}

// The hint of a PostgREST error body.
export function hintOf(res: { body: unknown }): unknown {
  return (res.body as { hint?: unknown } | null)?.hint;
}

// Each request is its own transaction, so only the per-user lock keeps two
// concurrent writes from both passing their guards. A race is not certain to
// show in one round, hence several.
export const RACE_ROUNDS = 10;

const RACE_HINTS = {
  portfolios: { inUse: "portfolio_in_use", archived: "portfolio_archived" },
  holders: { inUse: "holder_in_use", archived: "holder_archived" },
} as const satisfies Record<
  string,
  { inUse: PortfolioSetupGuardHint; archived: PortfolioSetupGuardHint }
>;

// An archive and a new account pointing at the same row: exactly one must win,
// the other refused with its hint. Each round undoes its winner.
export async function raceArchiveAgainstAccount(
  user: TestUser,
  {
    table,
    target,
    account,
    afterRound,
  }: {
    table: keyof typeof RACE_HINTS;
    target: (round: number) => Promise<string>;
    account: (id: string) => Insert<"source_connections">;
    afterRound: (id: string) => Promise<void>;
  },
): Promise<void> {
  const { inUse, archived } = RACE_HINTS[table];
  for (let round = 0; round < RACE_ROUNDS; round++) {
    const id = await target(round);
    let accountId: string | undefined;
    try {
      const [archive, create] = await Promise.all([
        rest(user, "PATCH", `${table}?id=eq.${id}`, {
          body: { archived_at: new Date().toISOString() },
        }),
        rest(user, "POST", "source_connections", {
          body: account(id),
          headers: { Prefer: "return=representation" },
        }),
      ]);
      if (create.status === 201) {
        accountId = (create.body as { id: string }[])[0]!.id;
        expectError(archive, 409, PORTFOLIO_SETUP_GUARD.sqlstate, inUse);
      } else {
        expect(archive.status).toBe(204);
        expectError(create, 409, PORTFOLIO_SETUP_GUARD.sqlstate, archived);
      }
    } finally {
      // The account goes first: an active one keeps its row from archiving.
      try {
        if (accountId) await archiveRow(user, "source_connections", accountId);
      } finally {
        await afterRound(id);
      }
    }
  }
}
