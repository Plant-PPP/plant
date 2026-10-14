import { importOrigin, importOriginSchema } from "./origin";

const ACCOUNT = "a5000000-0000-4000-8000-0000000000a5";

it("names an uploaded document's import by its file", () => {
  expect(
    importOrigin(
      importOriginSchema.parse({
        source_connection_id: null,
        provider: null,
        document: { file_name: "resumen.pdf", source_connection_id: ACCOUNT },
      }),
    ),
  ).toEqual({ fileName: "resumen.pdf", accountId: ACCOUNT });
});

it("names a sync by its provider and what it read", () => {
  expect(
    importOrigin(
      importOriginSchema.parse({
        source_connection_id: ACCOUNT,
        provider: "binance",
        document: null,
      }),
    ),
  ).toEqual({ fileName: "Sincronización con Binance", accountId: ACCOUNT });
  expect(
    importOrigin(
      importOriginSchema.parse({
        source_connection_id: ACCOUNT,
        provider: "wallbit",
        sync_draft: "operations",
        document: null,
      }),
    ).fileName,
  ).toBe("Operaciones de Wallbit");
});

it("refuses an import that reads neither", () => {
  expect(() =>
    importOrigin({
      source_connection_id: null,
      provider: null,
      document: null,
    }),
  ).toThrow();
});
