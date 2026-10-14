import * as XLSX from "xlsx";

import { cellOf, xlsxBlob } from "./xlsx";

it("writes a decimal as a number and everything else as text", () => {
  expect(cellOf("1234.56")).toBe(1234.56);
  expect(cellOf("-0.5")).toBe(-0.5);
  expect(cellOf("AL30")).toBe("AL30");
  expect(cellOf("2026-10-12")).toBe("2026-10-12");
  expect(cellOf("=HYPERLINK(1)")).toBe("=HYPERLINK(1)");
  expect(cellOf(null)).toBeNull();
});

it("reads an amount as the database writes it, trailing zeros and all", () => {
  expect(cellOf("10000000.00000000")).toBe(10000000);
  expect(cellOf("123456789.12000000")).toBe(123456789.12);
});

it("keeps as text what a double would change: leading zeros and long decimals", () => {
  expect(cellOf("000123")).toBe("000123");
  expect(cellOf("12345678901234567.89")).toBe("12345678901234567.89");
});

it("writes one sheet per table, its header first, no cell a formula", async () => {
  const blob = await xlsxBlob([
    {
      name: "tenencias",
      label: "Tenencias",
      header: ["Instrumento", "Cantidad o monto"],
      rows: [
        ["AL30", "1500.25"],
        ["=1+1", null],
      ],
    },
    { name: "deudas", label: "Deudas", header: ["Saldo"], rows: [] },
  ]);
  const book = XLSX.read(new Uint8Array(await blob.arrayBuffer()));
  expect(book.SheetNames).toEqual(["Tenencias", "Deudas"]);
  const sheet = book.Sheets.Tenencias!;
  expect(XLSX.utils.sheet_to_json(sheet, { header: 1 })).toEqual([
    ["Instrumento", "Cantidad o monto"],
    ["AL30", 1500.25],
    ["=1+1"],
  ]);
  expect(sheet.A3!.t).toBe("s");
  expect(sheet.A3!.f).toBeUndefined();
});
