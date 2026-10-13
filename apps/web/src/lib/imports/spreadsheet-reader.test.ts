import type { ColumnMapping } from "@plant/sources/spreadsheet";

jest.mock("server-only", () => ({}), { virtual: true });

import { captureServerLog } from "@/lib/log/capture-server-log";

import type { ColumnMappingsPort } from "./column-mappings-store";
import { spreadsheetReader } from "./spreadsheet-reader";

const CSV = "text/csv";
const csv = (text: string) => new TextEncoder().encode(text);
const STATEMENT = csv(
  "Especie;Cantidad;Precio;Moneda\nAL30;100;65.432,10;Pesos\nMELI;3;1.234,5;Pesos\n",
);
const MAPPING: ColumnMapping = {
  symbol: "Especie",
  quantity: "Cantidad",
  price: "Precio",
  value: null,
  currency: "Moneda",
  date: null,
  currencyDefault: null,
};

// Mappings kept in memory, per user, institution and headers.
function memoryMappings() {
  const kept = new Map<string, unknown>();
  const key = (user: string, institution: string, headers: readonly string[]) =>
    `${user}|${institution}|${headers.join(",")}`;
  const port: ColumnMappingsPort = {
    get: async (user, institution, headers) =>
      kept.get(key(user, institution, headers)) ?? null,
    save: async (user, institution, headers, mapping) => {
      kept.set(key(user, institution, headers), mapping);
    },
  };
  return { port, kept };
}

const now = () => new Date("2026-10-13T12:00:00Z");

beforeEach(() => captureServerLog());

it("maps a format's columns once, then reads the same format without the model", async () => {
  const { port } = memoryMappings();
  const mapColumns = jest.fn().mockResolvedValue(MAPPING);
  const read = spreadsheetReader({ mappings: port, mapColumns, now });
  const input = {
    bytes: STATEMENT,
    mimeType: CSV,
    importId: "i1",
    institution: "IOL",
  };

  const first = await read({ ...input, userId: "u1" });
  expect(first.read).toEqual({ reader: "sheet", mapping: "miss" });
  expect(
    first.draft.rows.map(({ symbol, quantity, price }) => [
      symbol,
      quantity,
      price,
    ]),
  ).toEqual([
    ["AL30", "100", "65432.10"],
    ["MELI", "3", "1234.5"],
  ]);

  const second = await read({ ...input, userId: "u1" });
  expect(second.read).toEqual({ reader: "sheet", mapping: "hit" });
  expect(mapColumns).toHaveBeenCalledTimes(1);

  // Another user with the same institution and headers maps their own.
  await read({ ...input, userId: "u2" });
  expect(mapColumns).toHaveBeenCalledTimes(2);
});

it("keeps no mapping that reads no rows", async () => {
  const { port, kept } = memoryMappings();
  const read = spreadsheetReader({
    mappings: port,
    mapColumns: jest
      .fn()
      .mockResolvedValue({ ...MAPPING, symbol: "Moneda", quantity: "Moneda" }),
    now,
  });
  const { draft } = await read({
    bytes: STATEMENT,
    mimeType: CSV,
    userId: "u1",
    importId: "i1",
    institution: "IOL",
  });
  expect(draft.rows).toEqual([]);
  expect(kept.size).toBe(0);
});

it("maps again when a kept mapping no longer fits the headers", async () => {
  const { port, kept } = memoryMappings();
  kept.set("u1|IOL|Especie,Cantidad,Precio,Moneda", { symbol: "Ticker" });
  const mapColumns = jest.fn().mockResolvedValue(MAPPING);
  const read = spreadsheetReader({ mappings: port, mapColumns, now });
  const { read: how } = await read({
    bytes: STATEMENT,
    mimeType: CSV,
    userId: "u1",
    importId: "i1",
    institution: "IOL",
  });
  expect(how.mapping).toBe("miss");
  expect(mapColumns).toHaveBeenCalledTimes(1);
});

it("reads the rows even when the mapping cannot be kept", async () => {
  const lines = captureServerLog();
  const read = spreadsheetReader({
    mappings: {
      get: async () => null,
      save: async () => {
        throw new Error("down");
      },
    },
    mapColumns: jest.fn().mockResolvedValue(MAPPING),
    now,
  });
  const { draft } = await read({
    bytes: STATEMENT,
    mimeType: CSV,
    userId: "u1",
    importId: "i1",
    institution: "IOL",
  });
  expect(draft.rows).toHaveLength(2);
  expect(lines.at(-1)).toMatchObject({
    event: "imports.column_mapping",
    "plant.import.id": "i1",
    "plant.outcome": "failed",
  });
  expect(JSON.stringify(lines)).not.toContain("Especie");
});
