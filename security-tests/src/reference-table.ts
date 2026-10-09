import { expectError, readEnv, rest, users } from "./pentest-helpers";
import { type QuoteCases, runEnv } from "./pentest-users";
import { type ReferenceTable, referenceRows } from "./reference-rows";

const quotes = readEnv<QuoteCases>(runEnv.quotes);
export const REFERENCE_TARGETS = referenceRows(quotes.date);

const { a, b } = users;

// Global setup seeded the row through the service role.
export function describeReferenceTable(table: ReferenceTable): void {
  const { filter, row } = REFERENCE_TARGETS[table];
  const target = `${table}?${filter}`;
  const writes = quotes.writes[table];
  let before: unknown;

  async function read(): Promise<unknown> {
    const res = await rest(a, "GET", target);
    expect(res.status).toBe(200);
    return res.body;
  }

  function expectDenied(res: Awaited<ReturnType<typeof rest>>): void {
    expectError(res, 403);
    expect((res.body as { message?: unknown }).message).toBe(
      `permission denied for table ${table}`,
    );
  }

  beforeAll(async () => {
    before = await read();
    expect(before).toHaveLength(1);
  });

  describe(`a user on ${table}`, () => {
    afterEach(async () => {
      expect(await read()).toEqual(before);
    });

    test("another user reads the same row", async () => {
      const res = await rest(b, "GET", target);
      expect(res.status).toBe(200);
      expect(res.body).toEqual(before);
    });

    test("POST is denied", async () => {
      expectDenied(await rest(a, "POST", table, { body: row }));
    });

    test("POST ignoring duplicates is denied", async () => {
      expectDenied(
        await rest(a, "POST", table, {
          body: row,
          headers: { Prefer: "resolution=ignore-duplicates" },
        }),
      );
    });

    test("PUT is denied", async () => {
      expectDenied(await rest(a, "PUT", target, { body: row }));
    });

    test("PATCH is denied", async () => {
      expectDenied(await rest(a, "PATCH", target, { body: row }));
    });

    test("DELETE is denied", async () => {
      expectDenied(await rest(a, "DELETE", target));
    });

    test("embedding auth users is not possible", async () => {
      expectError(
        await rest(a, "GET", `${table}?select=*,users(*)`),
        400,
        "PGRST200",
      );
    });
  });

  describe(`the service role on ${table}`, () => {
    test("inserting today's row again returns nothing", () => {
      expect(writes.again).toMatchObject({ status: 201, body: [] });
    });

    test("cannot insert yesterday's row", () => {
      expect(writes.yesterday).toMatchObject({ status: 403, code: "PT403" });
    });

    test("cannot overwrite a row", () => {
      expect(writes.merge).toMatchObject({ status: 403, code: "42501" });
    });

    test("cannot delete a row", () => {
      expect(writes.delete).toMatchObject({ status: 403, code: "42501" });
    });
  });
}
