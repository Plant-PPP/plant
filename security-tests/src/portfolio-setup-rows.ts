import { type Insert, rest } from "./pentest-helpers";
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
