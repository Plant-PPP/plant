jest.mock("server-only", () => ({}), { virtual: true });

import { readImports } from "./read";

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
