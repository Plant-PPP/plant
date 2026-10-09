import {
  expectError,
  expectOnlyOwnRows,
  rest,
  rowsOf,
  users,
} from "./pentest-helpers";
import type { OwnedTable } from "./reference-rows";

const { a, b } = users;

// What another user can try on any owned table, whatever its grants: A reads
// and deletes B's rows. Both users need rows before it runs. The cases that
// depend on the table's grants go in `writes`, which shares the check that B's
// rows never change.
export function describeAnotherUserAccess(
  table: OwnedTable,
  writes: () => void = () => {},
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

    test("DELETE of B's rows is denied", async () => {
      expectError(await rest(a, "DELETE", `${table}?user_id=eq.${b.id}`), 403);
    });

    test("embedding auth users is not possible", async () => {
      expectError(
        await rest(a, "GET", `${table}?select=*,users(*)`),
        400,
        "PGRST200",
      );
    });

    test("an unfiltered GET returns only its own rows", async () => {
      await expectOnlyOwnRows(a, table);
    });

    writes();
  });
}
