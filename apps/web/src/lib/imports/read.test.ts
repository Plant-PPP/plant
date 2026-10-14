jest.mock("server-only", () => ({}), { virtual: true });

import { IMPORTS_LISTED, readImportForReview, readImports } from "./read";

const rpcs: string[] = [];
// The list answers at most the rows asked for, as PostgREST does.
const clientOf = (list: unknown, used: number | null) => ({
  from: () => {
    let limit = Infinity;
    const builder = {
      select: () => builder,
      order: () => builder,
      limit: (rows: number) => ((limit = rows), builder),
      then: (resolve: (value: unknown) => unknown) =>
        resolve({
          status: 200,
          data: Array.isArray(list) ? list.slice(0, limit) : list,
          error: null,
        }),
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
          document: {
            file_name: "Resumen.pdf",
            mime_type: "application/pdf",
            source_connection_id: "a1",
          },
        },
      ],
      3,
    ) as never,
  );
  expect(read).toEqual({
    used: 3,
    truncated: false,
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
        origin: "document",
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
          document: {
            file_name: "a.csv",
            mime_type: "text/csv",
            source_connection_id: "a1",
          },
        },
        {
          id: "i3",
          status: "ready",
          failure: null,
          document_date: "2026-09-30",
          created_at: "2026-10-12T15:00:00+00:00",
          document: {
            file_name: "b.pdf",
            mime_type: "application/pdf",
            source_connection_id: "a1",
          },
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

it("lists a sync by its provider and says why it failed in its own words", async () => {
  const failed = (failure: string, id: string, synced: boolean) => ({
    id,
    status: "failed",
    failure,
    document_date: null,
    created_at: "2026-10-12T15:00:00+00:00",
    source_connection_id: synced ? "a1" : null,
    provider: synced ? "binance" : null,
    document: synced
      ? null
      : {
          file_name: "c.pdf",
          mime_type: "application/pdf",
          source_connection_id: "a1",
        },
  });
  const read = await readImports(
    clientOf(
      [
        failed("nothing_found", "s1", true),
        failed("extraction_failed", "s2", true),
        failed("nothing_found", "f1", false),
      ],
      0,
    ) as never,
  );
  expect(
    read.items.map(({ fileName, accountId, error }) => [
      fileName,
      accountId,
      error,
    ]),
  ).toEqual([
    [
      "Sincronización con Binance",
      "a1",
      "No encontramos saldos ni operaciones en la cuenta conectada.",
    ],
    [
      "Sincronización con Binance",
      "a1",
      "No pudimos leer la cuenta conectada. Probá de nuevo más tarde.",
    ],
    ["c.pdf", "a1", "No encontramos tenencias ni operaciones en el archivo."],
  ]);
});

describe("with 51 imports", () => {
  const imports = Array.from({ length: 51 }, (_, index) => ({
    id: `i${index}`,
    status: "ready",
    failure: null,
    document_date: null,
    created_at: "2026-10-12T15:00:00+00:00",
    document: {
      file_name: "a.pdf",
      mime_type: "application/pdf",
      source_connection_id: "a1",
    },
  }));

  it("lists the latest IMPORTS_LISTED and says the list was cut", async () => {
    const read = await readImports(clientOf(imports, 0) as never);
    expect(read.items).toHaveLength(IMPORTS_LISTED);
    expect(read.truncated).toBe(true);
  });

  it("reads them all when asked for more", async () => {
    const read = await readImports(clientOf(imports, 0) as never, {
      limit: 100,
    });
    expect(read.items).toHaveLength(51);
    expect(read.truncated).toBe(false);
  });
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
  const clientWith = (
    found: unknown[],
    items: unknown[],
    operations: unknown[] = [],
  ) => ({
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
            data:
              table === "imports"
                ? found
                : table === "import_operations"
                  ? operations
                  : table === "import_debts"
                    ? []
                    : items,
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
    document: {
      file_name: "resumen.pdf",
      mime_type: "application/pdf",
      source_connection_id: "a1",
    },
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

  it("reads cash as a balance in its currency, never as an instrument", async () => {
    const read = await readImportForReview(
      clientWith(
        [IMPORT],
        [
          item({
            id: "c1",
            symbol: "USD",
            quantity: "812.4",
            price: null,
            asset_class: "cash",
            currency: "USD",
            source_page: null,
          }),
          item({ id: "r1", asset_class: "instrument" }),
        ],
      ) as never,
      "i1",
      INSTRUMENTS,
    );
    expect(read!.rows).toEqual([
      {
        id: "c1",
        assetClass: "cash",
        symbol: "USD",
        quantity: "812.4",
        price: null,
        value: null,
        currency: "USD",
        confidence: "high",
        source: "Del documento",
        discarded: false,
      },
      expect.objectContaining({ id: "r1", symbol: "AAPL" }),
    ]);
    expect(read!.rows[1]).not.toHaveProperty("assetClass");
  });

  it("labels a synced balance by the sync, not a document", async () => {
    const read = await readImportForReview(
      clientWith(
        [
          {
            ...IMPORT,
            document: null,
            source_connection_id: "a1",
            provider: "binance",
            sync_draft: "holdings",
          },
        ],
        [
          item({
            id: "c1",
            symbol: "USD",
            quantity: "812.4",
            price: null,
            asset_class: "cash",
            currency: "USD",
            source_page: null,
          }),
        ],
      ) as never,
      "i1",
      INSTRUMENTS,
    );
    expect(read!.rows[0]!.source).toBe("De la sincronización");
  });

  it("labels a synced holding by the sync, not a document", async () => {
    const read = await readImportForReview(
      clientWith(
        [
          {
            ...IMPORT,
            document: null,
            source_connection_id: "a1",
            provider: "binance",
            sync_draft: "holdings",
          },
        ],
        [item({ id: "h1", source_page: null })],
      ) as never,
      "i1",
      INSTRUMENTS,
    );
    expect(read!.rows[0]!.source).toBe("De la sincronización");
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
  it("reads a draft of operations, asking for what it does not name", async () => {
    const operation = (patch: Record<string, unknown>) => ({
      id: "o1",
      date: "2026-09-01",
      kind: "purchase",
      symbol: "AAPL",
      quantity: "5",
      price: "18000",
      amount: null,
      charges: "120.5",
      reference: "123",
      currency: "ARS",
      confidence: "high",
      source_page: 1,
      ...patch,
    });
    const read = await readImportForReview(
      clientWith(
        [IMPORT],
        [],
        [
          operation({}),
          operation({ id: "o2", symbol: null, source_page: null }),
          operation({
            id: "o3",
            symbol: "GD30D",
            // Read as pesos: a dollar line is a dollar trade all the same.
            currency: "ARS",
            price: "65",
          }),
        ],
      ) as never,
      "i1",
      INSTRUMENTS,
    );
    expect(read?.rows).toEqual([]);
    expect(
      read?.operations?.map(({ id, symbol, currency, price, source }) => ({
        id,
        symbol,
        currency,
        price,
        source,
      })),
    ).toEqual([
      {
        id: "o1",
        symbol: "AAPL",
        currency: "ARS",
        price: "18000",
        source: "Página 1",
      },
      {
        id: "o2",
        symbol: "",
        currency: "ARS",
        price: "18000",
        source: "El documento no dice qué activo es",
      },
      {
        id: "o3",
        symbol: "GD30",
        currency: "USD",
        price: "65",
        source: 'Página 1 · Leído como "GD30D"',
      },
    ]);
  });
  it("keeps the currency of an operation named by an alias ending in D", async () => {
    const read = await readImportForReview(
      clientWith(
        [IMPORT],
        [],
        [
          {
            id: "o1",
            date: "2026-09-01",
            kind: "purchase",
            symbol: "XD",
            quantity: "5",
            price: "100",
            amount: null,
            charges: null,
            reference: null,
            currency: "ARS",
            confidence: "high",
            source_page: 1,
          },
        ],
      ) as never,
      "i1",
      [
        {
          symbol: "X",
          name: "Fondo X",
          currency: "ARS",
          type: "fci",
          aliases: ["XD"],
        },
      ],
    );
    expect(
      read?.operations?.map(({ symbol, currency }) => ({ symbol, currency })),
    ).toEqual([{ symbol: "X", currency: "ARS" }]);
  });
  it("proposes a printed cost only when it reads as one unit's", async () => {
    const read = await readImportForReview(
      clientWith(
        [IMPORT],
        [
          item({ id: "unit", cost: "15000" }),
          item({ id: "total", cost: "900000" }),
        ],
      ) as never,
      "i1",
      INSTRUMENTS,
    );
    expect(read?.rows.map((row) => [row.id, row.cost])).toEqual([
      ["unit", "15000"],
      ["total", undefined],
    ]);
  });
});
