jest.mock("server-only", () => ({}), { virtual: true });

import { readImportForReview, readImports } from "./read";

const filters: unknown[][] = [];
const clientOf = (list: unknown, count: number | null) => ({
  from: () => {
    let head = false;
    const builder = {
      select: (_: string, options?: { head?: boolean }) => {
        head = options?.head === true;
        return builder;
      },
      order: () => builder,
      limit: () => builder,
      gte: (...args: unknown[]) => (filters.push(args), builder),
      then: (resolve: (value: unknown) => unknown) =>
        resolve(
          head
            ? { status: 200, count, data: null, error: null }
            : { status: 200, data: list, error: null },
        ),
    };
    return builder;
  },
});

it("lists each import by its file and account, dated in Buenos Aires", async () => {
  filters.length = 0;
  const read = await readImports(
    clientOf(
      [
        {
          id: "i1",
          status: "queued",
          failure: null,
          document_date: null,
          created_at: "2026-10-01T02:00:00+00:00",
          document: { file_name: "Resumen.pdf", source_connection_id: "a1" },
        },
      ],
      3,
    ) as never,
    "2026-10-13",
  );
  expect(read).toEqual({
    used: 3,
    items: [
      {
        id: "i1",
        fileName: "Resumen.pdf",
        accountId: "a1",
        status: "queued",
        error: null,
        documentDate: null,
        documentTotals: [],
        rows: [],
        createdOn: "2026-09-30",
      },
    ],
  });
  expect(filters).toEqual([["created_at", "2026-10-01T00:00:00-03:00"]]);
});

it("says why a failed import stopped, and keeps a read one's date", async () => {
  const read = await readImports(
    clientOf(
      [
        {
          id: "i2",
          status: "failed",
          failure: "unsupported",
          document_date: null,
          created_at: "2026-10-12T15:00:00+00:00",
          document: { file_name: "a.csv", source_connection_id: "a1" },
        },
        {
          id: "i3",
          status: "ready",
          failure: null,
          document_date: "2026-09-30",
          created_at: "2026-10-12T15:00:00+00:00",
          document: { file_name: "b.pdf", source_connection_id: "a1" },
        },
      ],
      2,
    ) as never,
    "2026-10-13",
  );
  expect(
    read.items.map(({ error, documentDate }) => [error, documentDate]),
  ).toEqual([
    ["Por ahora leemos PDF e imágenes; CSV y Excel llegan pronto.", null],
    [null, "2026-09-30"],
  ]);
});

it("throws when the count is missing", async () => {
  await expect(
    readImports(clientOf([], null) as never, "2026-10-13"),
  ).rejects.toThrow("imports read failed");
});

describe("readImportForReview", () => {
  const INSTRUMENTS = [
    {
      symbol: "AAPL",
      name: "Apple",
      currency: "ARS" as const,
      type: "cedear" as const,
    },
    {
      symbol: "GD30",
      name: "Global 2030",
      currency: "USD" as const,
      type: "bond" as const,
    },
  ];
  const clientWith = (found: unknown[], items: unknown[]) => ({
    from: (table: string) => {
      const builder = {
        select: () => builder,
        eq: () => builder,
        limit: () => builder,
        order: () => builder,
        then: (resolve: (value: unknown) => unknown) =>
          resolve({
            status: 200,
            error: null,
            data: table === "imports" ? found : items,
          }),
      };
      return builder;
    },
  });
  const IMPORT = {
    id: "i1",
    status: "ready",
    failure: null,
    document_date: "2026-09-30",
    created_at: "2026-10-12T15:00:00+00:00",
    document: { file_name: "resumen.pdf", source_connection_id: "a1" },
  };
  const item = (patch: Record<string, unknown>) => ({
    id: "r1",
    symbol: "AAPL",
    quantity: "5",
    price: "18000",
    currency: "ARS",
    confidence: "high",
    source_page: 1,
    ...patch,
  });

  it("reads the draft as the review edits it", async () => {
    const read = await readImportForReview(
      clientWith(
        [IMPORT],
        [
          item({}),
          item({
            id: "r2",
            symbol: "gd30",
            price: "75500",
            currency: "USD",
            source_page: 2,
          }),
          item({
            id: "r3",
            symbol: "ALUAR",
            price: null,
            confidence: "low",
            source_page: null,
          }),
        ],
      ) as never,
      "i1",
      INSTRUMENTS,
    );
    expect(read).toMatchObject({
      id: "i1",
      accountId: "a1",
      documentDate: "2026-09-30",
      status: "ready",
    });
    expect(read!.rows).toEqual([
      {
        id: "r1",
        symbol: "AAPL",
        quantity: "5",
        price: "18000",
        currency: "ARS",
        confidence: "high",
        source: "Página 1",
        discarded: false,
      },
      // A bond's printed price is per 100 nominal.
      expect.objectContaining({
        symbol: "GD30",
        price: "755",
        source: "Página 2",
      }),
      // One Plant does not know is left for the user to choose.
      expect.objectContaining({
        symbol: "",
        price: null,
        source: 'Leído como "ALUAR"',
      }),
    ]);
  });

  it("finds no import that is not the user's", async () => {
    expect(
      await readImportForReview(clientWith([], []) as never, "i1", INSTRUMENTS),
    ).toBeNull();
  });
});
