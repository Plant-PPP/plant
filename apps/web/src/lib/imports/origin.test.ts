import { importOrigin, importOriginSchema } from "./origin";

const ACCOUNT = "a5000000-0000-4000-8000-0000000000a5";

const uploaded = (file_name: string, mime_type: string) =>
  importOrigin(
    importOriginSchema.parse({
      source_connection_id: null,
      provider: null,
      document: { file_name, mime_type, source_connection_id: ACCOUNT },
    }),
  );

it("names an uploaded document's import by its file", () => {
  expect(uploaded("resumen.pdf", "application/pdf")).toEqual({
    fileName: "resumen.pdf",
    accountId: ACCOUNT,
    origin: "document",
  });
});

it("tells a spreadsheet from a document by its type", () => {
  expect(uploaded("tenencias.csv", "text/csv").origin).toBe("sheet");
  expect(
    uploaded(
      "tenencias.xlsx",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ).origin,
  ).toBe("sheet");
  expect(uploaded("captura.png", "image/png").origin).toBe("document");
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
  ).toEqual({
    fileName: "Sincronización con Binance",
    accountId: ACCOUNT,
    origin: "sync",
  });
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
