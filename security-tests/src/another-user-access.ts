import {
  expectNoAuthUsersEmbed,
  expectOnlyOwnRows,
  expectRelationDenied,
  rest,
  rowsOf,
  users,
} from "./pentest-helpers";
import type { Database } from "@plant/shared";

import type { OwnedTable } from "./reference-rows";

const { a, b } = users;

type Tables = Database["public"]["Tables"];
type IdTable = {
  [T in OwnedTable]: "id" extends keyof Tables[T]["Row"] ? T : never;
}[OwnedTable];

// What another user can try on every owned table: read B's rows, delete them,
// embed auth users and read unfiltered. Both users need rows before it runs. The DELETE case expects the table
// refused because no owned table grants DELETE; under a grant RLS would answer
// 204 and leave B's rows alone. The cases specific to the table go in `cases`,
// which shares the check that B's rows never change.
export function describeAnotherUserAccess(
  table: OwnedTable,
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

// For the cases of a table keyed by `id`; profiles is keyed by user_id.
export function testHiddenById(table: IdTable): void {
  test("GET of B's row by id returns nothing", async () => {
    const [row] = (await rest(b, "GET", table)).body as { id: string }[];
    expect(row).toBeDefined();
    const res = await rest(a, "GET", `${table}?id=eq.${row!.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
}
