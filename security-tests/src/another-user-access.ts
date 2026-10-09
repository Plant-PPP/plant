import {
  type Insert,
  expectError,
  expectNoAuthUsersEmbed,
  expectOnlyOwnRows,
  expectRelationDenied,
  rest,
  rowsOf,
  users,
} from "./pentest-helpers";
import { OWNED_KEYS, type OwnedTable } from "./reference-rows";

const { a, b } = users;

// What another user can try on every owned table: read B's rows, by id where
// the table has one, write `rowForB`, delete B's rows, embed auth users and
// read unfiltered. Both users need rows before it runs. The DELETE case expects
// the table refused because no owned table grants DELETE; under a grant RLS
// would answer 204 and leave B's rows alone. The cases specific to the table,
// such as a PATCH of B's rows, go in `cases`, which shares the check that B's
// rows never change.
export function describeAnotherUserAccess<T extends OwnedTable>(
  table: T,
  rowForB: Insert<T>,
  cases: () => void,
): void {
  describe(`another user on ${table}`, () => {
    let before: string[];

    beforeAll(async () => {
      before = await rowsOf(b, table);
      expect(before.length).toBeGreaterThan(0);
    });

    afterEach(async () => {
      expect(await rowsOf(b, table)).toEqual(before);
    });

    test("GET of B's rows returns nothing", async () => {
      const res = await rest(a, "GET", `${table}?user_id=eq.${b.id}`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    if (OWNED_KEYS[table] === "id") {
      test("GET of B's row by id returns nothing", async () => {
        const own = await rest(
          b,
          "GET",
          `${table}?user_id=eq.${b.id}&select=id`,
        );
        expect(own.status).toBe(200);
        const [row] = own.body as { id: string }[];
        expect(row).toBeDefined();
        const res = await rest(a, "GET", `${table}?id=eq.${row!.id}`);
        expect(res.status).toBe(200);
        expect(res.body).toEqual([]);
      });
    }

    // A missing grant and a WITH CHECK both answer 403 42501, so this cannot
    // tell which one stopped it; each table's supabase/tests/*_isolation_test.sql
    // covers the policy.
    test("POST of a row for B is denied", async () => {
      expect((rowForB as { user_id?: unknown }).user_id).toBe(b.id);
      expectError(await rest(a, "POST", table, { body: rowForB }), 403);
    });

    test("DELETE of B's rows is denied", async () => {
      expectRelationDenied(
        await rest(a, "DELETE", `${table}?user_id=eq.${b.id}`),
        table,
      );
    });

    test("embedding auth users is not possible", async () => {
      await expectNoAuthUsersEmbed(a, table);
    });

    test("an unfiltered GET returns only its own rows", async () => {
      await expectOnlyOwnRows(a, table);
    });

    cases();
  });
}
