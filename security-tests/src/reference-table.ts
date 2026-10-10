import {
  expectError,
  expectNoAuthUsersEmbed,
  expectRelationDenied,
  readEnv,
  rest,
  users,
} from "./pentest-helpers";
import { type QuoteCases, runEnv } from "./pentest-users";
import {
  type QuoteTable,
  type ReferenceRow,
  type ReferenceTable,
  filterOf,
  referenceRows,
} from "./reference-rows";

const quotes = readEnv<QuoteCases>(runEnv.quotes);
// The quote rows global setup seeded through the service role, and an
// instrument the migration seeded.
const QUOTE_TARGETS = referenceRows(quotes.date);
export const REFERENCE_TARGETS = {
  ...QUOTE_TARGETS,
  instruments: {
    key: ["symbol"],
    row: { symbol: "BTC", name: "Bitcoin", type: "crypto", currency: "USD" },
  },
} satisfies { [T in ReferenceTable]: ReferenceRow<T> };

const { a, b } = users;

const deniedOn =
  (table: ReferenceTable) =>
  (res: Parameters<typeof expectRelationDenied>[0]) =>
    expectRelationDenied(res, table);

export const isQuoteTable = (table: ReferenceTable): table is QuoteTable =>
  Object.hasOwn(QUOTE_TARGETS, table);

export function describeReferenceTable(table: ReferenceTable): void {
  const { row } = REFERENCE_TARGETS[table];
  const target = `${table}?${filterOf(REFERENCE_TARGETS[table])}`;
  let before: unknown;

  async function read(): Promise<unknown> {
    const res = await rest(a, "GET", target);
    expect(res.status).toBe(200);
    return res.body;
  }

  const expectDenied = deniedOn(table);

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
      await expectNoAuthUsersEmbed(a, table);
    });
  });

  if (isQuoteTable(table)) describeQuoteServiceRole(table);
}

// What the service role, which writes quotes daily, may and may not do.
function describeQuoteServiceRole(table: QuoteTable): void {
  const writes = quotes.writes[table];
  const expectDenied = deniedOn(table);

  describe(`the service role on ${table}`, () => {
    test("inserting today's row again returns nothing", () => {
      expect(writes.again).toMatchObject({ status: 201, body: [] });
    });

    test("cannot insert yesterday's row", () => {
      expectError(writes.yesterday, 403, "PT403");
    });

    test("cannot overwrite a row", () => {
      expectDenied(writes.merge);
    });

    test("cannot delete a row", () => {
      expectDenied(writes.delete);
    });
  });
}
