jest.mock("server-only", () => ({}), { virtual: true });

import { readImportForReview, readImports } from "./read";

const rpcs: string[] = [];
const clientOf = (list: unknown, used: number | null) => ({
  from: () => {
    const builder = {
      select: () => builder,
      order: () => builder,
      limit: () => builder,
      then: (resolve: (value: unknown) => unknown) =>
        resolve({ status: 200, data: list, error: null }),
    };
    return builder;
  },
  rpc: async (name: string) => (
    rpcs.push(name),
    { status: 200, data: used, error: null }
  ),
});

it("lists each import by its file and account, dated in Buenos Aires", async () => {
  rpcs.length = 0;
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
        skippedRows: 0,
        rows: [],
        createdOn: "2026-09-30",
      },
    ],
  });
  expect(rpcs).toEqual(["imports_used_this_month"]);
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
  );
  expect(
    read.items.map(({ error, documentDate }) => [error, documentDate]),
  ).toEqual([
    ["No leemos este tipo de archivo.", null],
    [null, "2026-09-30"],
  ]);
});

it("throws when the count is missing", async () => {
  await expect(readImports(clientOf([], null) as never)).rejects.toThrow(
    "imports read failed",
  );
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
    printed_total_ars: "90000.00",
    printed_total_usd: null,
    skipped_rows: 0,
    document: { file_name: "resumen.pdf", source_connection_id: "a1" },
  };
  const item = (patch: Record<string, unknown>) => ({
    id: "r1",
    symbol: "AAPL",
    quantity: "5",
    price: "18000",
    value: null,
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
      // Only the totals the document prints.
      documentTotals: [{ currency: "ARS", amount: "90000.00" }],
    });
    expect(read!.rows).toEqual([
      {
        id: "r1",
        symbol: "AAPL",
        quantity: "5",
        price: "18000",
        value: null,
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

  it("names an instrument by its aliases and its dollar lines", async () => {
    const read = await readImportForReview(
      clientWith(
        [IMPORT],
        [
          item({ symbol: "Apple Inc.", value: "90000" }),
          // A dollar line of a peso bond: its dollar price waits for the user.
          item({
            id: "r2",
            symbol: "AL30D",
            price: "65.50",
            value: "6550",
            currency: "USD",
          }),
        ],
      ) as never,
      "i1",
      [
        { ...INSTRUMENTS[0]!, aliases: ["APPLE INC"] },
        {
          symbol: "AL30",
          name: "Bonar 2030",
          currency: "ARS" as const,
          type: "bond" as const,
        },
      ],
    );
    expect(read!.rows).toEqual([
      expect.objectContaining({
        symbol: "AAPL",
        price: "18000",
        value: "90000",
        source: 'Página 1 · Leído como "Apple Inc."',
      }),
      expect.objectContaining({
        symbol: "AL30",
        price: null,
        value: null,
        currency: "ARS",
        source: 'Página 1 · Leído como "AL30D"',
      }),
    ]);
  });

  it("finds no import that is not the user's", async () => {
    expect(
      await readImportForReview(clientWith([], []) as never, "i1", INSTRUMENTS),
    ).toBeNull();
  });
});
