import { type Update, expectError, rest, users } from "./pentest-helpers";
import type { OwnedTable } from "./reference-rows";

const { a, b } = users;

// The cases of an owned table authenticated may UPDATE, run inside
// describeAnotherUserAccess's `cases`, whose afterEach proves B's rows never
// change. `patch` is a change A may make to its own rows.
export function updateGrantedCases<T extends OwnedTable>(
  table: T,
  patch: Update<T>,
): void {
  // RLS filters B's rows out of the update, so it answers success and changes
  // nothing.
  test("PATCH of B's rows changes nothing", async () => {
    const res = await rest(a, "PATCH", `${table}?user_id=eq.${b.id}`, {
      body: patch,
    });
    expect(res.status).toBe(204);
  });

  // The column grant stops it today; the table's isolation test in
  // supabase/tests covers the policy behind it.
  test("moving its own rows to B is denied", async () => {
    const body = { user_id: b.id } as Update<T>;
    expectError(
      await rest(a, "PATCH", `${table}?user_id=eq.${a.id}`, { body }),
      403,
    );
  });
}
