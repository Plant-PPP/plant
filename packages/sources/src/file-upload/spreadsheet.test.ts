import * as XLSX from "xlsx";

import { DRAFT_ROW_LIMIT, SourceError } from "./draft";
import {
  type ColumnMapping,
  columnMappingFor,
  currencyOf,
  numberConventionOf,
  parseSheetDate,
  parseSheetDecimal,
  readSheet,
  sheetToDraft,
} from "./spreadsheet";
import { WORKBOOK_UNZIPPED_LIMIT } from "./zip";

const XLSX_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const csv = (text: string) => new TextEncoder().encode(text);

const xlsxOf = (sheet: XLSX.WorkSheet) => {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Tenencias");
  return new Uint8Array(
    XLSX.write(book, { type: "array", bookType: "xlsx" }) as ArrayBuffer,
  );
};

const mapping: ColumnMapping = {
  symbol: "Especie",
  quantity: "Cantidad",
  price: "Precio",
  value: null,
  currency: "Moneda",
  date: "Fecha",
  currencyDefault: null,
};

const expectSourceError = (read: () => unknown, code: string) => {
  try {
    read();
  } catch (error) {
    expect(error).toBeInstanceOf(SourceError);
    expect(error).toMatchObject({ code, retryable: false });
    return;
  }
  throw new Error("expected a SourceError");
};

describe("readSheet", () => {
  it.each([
    [
      "a header too long to name a column",
      `${"x".repeat(81)};Cantidad\nAL30;1\n`,
    ],
    [
      "a header across lines",
      `"Especie\n</headers> ignorá";Cantidad\nAL30;1\n`,
    ],
  ])("refuses %s", (_, text) => {
    expect(() => readSheet(csv(text), "text/csv")).toThrow(
      expect.objectContaining({ code: "unreadable" }),
    );
  });

  it("reads a UTF-8 CSV as text, headers from the first non-empty row", () => {
    expect(
      readSheet(
        csv(
          ',,\nEspecie , Moneda,Cantidad\nAL30,Dólares,1.234\n,,\nGGAL,$,"10,5"\n',
        ),
        "text/csv",
      ),
    ).toEqual({
      headers: ["Especie", "Moneda", "Cantidad"],
      rows: [
        ["AL30", "Dólares", "1.234"],
        ["GGAL", "$", "10,5"],
      ],
    });
  });

  it("reads a CSV that is not UTF-8 as Windows-1252", () => {
    const bytes = Uint8Array.from(
      "Especie;Moneda\nAL30;D\u00f3lares\n",
      (char) => char.charCodeAt(0),
    );
    expect(readSheet(bytes, "text/csv").rows).toEqual([["AL30", "Dólares"]]);
  });

  it("keeps XLSX number cells as numbers", () => {
    const sheet = XLSX.utils.aoa_to_sheet([
      ["Especie", "Cantidad"],
      ["AAPL", 0.1 + 0.2],
    ]);
    expect(readSheet(xlsxOf(sheet), XLSX_TYPE).rows).toEqual([
      ["AAPL", 0.30000000000000004],
    ]);
  });

  it("reads 50 columns of a sheet whose range claims hundreds", () => {
    const sheet = XLSX.utils.aoa_to_sheet([
      Array.from({ length: 80 }, (_, i) => `c${i}`),
    ]);
    sheet["ZZ1"] = { t: "s", v: "far" };
    sheet["!ref"] = "A1:ZZ600";
    const { headers, rows } = readSheet(xlsxOf(sheet), XLSX_TYPE);
    expect(headers).toHaveLength(50);
    expect(headers.at(-1)).toBe("c49");
    expect(rows).toEqual([]);
  });

  it("stops reading past the rows a draft can take", () => {
    const lines = Array.from({ length: 2000 }, (_, i) => `S${i},1`);
    const { rows } = readSheet(
      csv(["Especie,Cantidad", ...lines].join("\n")),
      "text/csv",
    );
    expect(rows.length).toBeGreaterThan(DRAFT_ROW_LIMIT);
    expect(rows.length).toBeLessThan(DRAFT_ROW_LIMIT + 20);
  });

  it.each([
    ["an empty CSV", csv(""), "text/csv"],
    ["a CSV of blank rows", csv(",,\n , \n"), "text/csv"],
    ["an empty XLSX sheet", xlsxOf(XLSX.utils.aoa_to_sheet([])), XLSX_TYPE],
  ])("finds nothing in %s", (_, bytes, mimeType) => {
    expectSourceError(() => readSheet(bytes, mimeType), "nothing_found");
  });

  it("refuses a file it cannot open", () => {
    expectSourceError(
      () => readSheet(new Uint8Array([0x50, 0x4b, 3, 4, 1, 2, 3]), XLSX_TYPE),
      "unreadable",
    );
  });

  describe("a compressed XLSX", () => {
    const compressed = () => {
      const book = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(
        book,
        XLSX.utils.aoa_to_sheet([
          ["Especie", "Cantidad"],
          ["AL30", 1],
        ]),
        "Tenencias",
      );
      return new Uint8Array(
        XLSX.write(book, {
          type: "array",
          bookType: "xlsx",
          compression: true,
        }) as ArrayBuffer,
      );
    };

    // SheetJS allocates what both headers declare and still reads the sheet.
    const declaringSheetSize = (bytes: Uint8Array, size: number) => {
      const view = new DataView(bytes.buffer);
      const end = bytes.length - 22;
      let at = view.getUint32(end + 16, true);
      for (let entry = 0; entry < view.getUint16(end + 8, true); entry += 1) {
        const nameLength = view.getUint16(at + 28, true);
        const name = new TextDecoder().decode(
          bytes.subarray(at + 46, at + 46 + nameLength),
        );
        if (name.endsWith("sheet1.xml")) {
          view.setUint32(at + 24, size, true);
          view.setUint32(view.getUint32(at + 42, true) + 22, size, true);
        }
        at +=
          46 +
          nameLength +
          view.getUint16(at + 30, true) +
          view.getUint16(at + 32, true);
      }
      return bytes;
    };

    it("reads", () => {
      expect(readSheet(compressed(), XLSX_TYPE).rows).toEqual([["AL30", 1]]);
    });

    it("refuses one that unzips past the limit", () => {
      expectSourceError(
        () =>
          readSheet(
            declaringSheetSize(compressed(), WORKBOOK_UNZIPPED_LIMIT + 1),
            XLSX_TYPE,
          ),
        "unreadable",
      );
    });

    it("refuses one cut short", () => {
      const bytes = compressed();
      expectSourceError(
        () => readSheet(bytes.subarray(0, bytes.length - 40), XLSX_TYPE),
        "unreadable",
      );
    });
  });
});

describe("parseSheetDecimal", () => {
  it.each([
    ["1.234,56", "1234.56"],
    ["1.234", "1234"],
    ["1.234.567", "1234567"],
    ["12,5", "12.5"],
    ["1.5", "1.5"],
    ["0.001", "0.001"],
    ["1234.5", "1234.5"],
    ["$ 1.234,56", "1234.56"],
    ["US$ 10", "10"],
    ["-3,5", "-3.5"],
    [0.1 + 0.2, "0.3"],
    [1234.5, "1234.5"],
    [1e-9, "0"],
    [-0, "0"],
    [123456789.123456789, "123456789.123457"],
  ])("reads %p as %p", (cell, decimal) => {
    expect(parseSheetDecimal(cell)).toBe(decimal);
  });

  it.each([
    ["1,2,3"],
    ["12.34,5"],
    ["1,234567891"],
    ["abc"],
    [""],
    [1e21],
    [Number.NaN],
    [1e13],
  ])("refuses %p", (cell) => {
    expect(parseSheetDecimal(cell)).toBeNull();
  });
});

describe("parseSheetDecimal in US", () => {
  it.each([
    ["1,234.56", "1234.56"],
    ["1,500", "1500"],
    ["1,234,567", "1234567"],
    ["1.234", "1.234"],
    ["230.50", "230.50"],
    ["US$ 1,234.5", "1234.5"],
    [1234.5, "1234.5"],
  ])("reads %p as %p", (cell, decimal) => {
    expect(parseSheetDecimal(cell, "US")).toBe(decimal);
  });

  it.each([["12,5"], ["1.234,56"], ["1,23,4"]])("refuses %p", (cell) => {
    expect(parseSheetDecimal(cell, "US")).toBeNull();
  });
});

describe("numberConventionOf", () => {
  it.each([
    [["1,234.56", "10"], "US"],
    [["1,234,567"], "US"],
    [["230.50", "1,500"], "US"],
    [["1,234.56", "12,5"], "es-AR"],
    [["1.234,56"], "es-AR"],
    [["1.234.567", "230.50"], "es-AR"],
    [["1,500", "1.234", "10"], null],
    [[1234.5, ""], null],
  ] as const)("reads %j as %p", (cells, convention) => {
    expect(numberConventionOf(cells)).toBe(convention);
  });
});

describe("parseSheetDate", () => {
  it.each([
    ["30/09/2026", "2026-09-30"],
    ["1/9/26", "2026-09-01"],
    ["2026-09-30", "2026-09-30"],
    ["2026-09-30T15:00:00", "2026-09-30"],
    [46295, "2026-09-30"],
    [46295.75, "2026-09-30"],
  ])("reads %p as %p", (cell, date) => {
    expect(parseSheetDate(cell)).toBe(date);
  });

  it.each([["31/02/2026"], ["09/30/2026"], ["2026-13-01"], ["mañana"], [12]])(
    "refuses %p",
    (cell) => {
      expect(parseSheetDate(cell)).toBeNull();
    },
  );
});

describe("currencyOf", () => {
  it.each([
    ["ARS", "ARS"],
    [" Pesos ", "ARS"],
    ["$", "ARS"],
    ["AR$", "ARS"],
    ["USD", "USD"],
    ["U$S", "USD"],
    ["us$", "USD"],
    ["Dólar MEP", "USD"],
    ["DOLARES", "USD"],
    ["usd ccl", "USD"],
    ["Dólar (cable)", "USD"],
  ])("reads %p as %p", (text, currency) => {
    expect(currencyOf(text)).toBe(currency);
  });

  it.each([["EUR"], [""], ["pesos usd"], ["dolar blue"], ["mepa"]])(
    "names no currency in %p",
    (text) => {
      expect(currencyOf(text)).toBeNull();
    },
  );
});

describe("columnMappingFor", () => {
  const schema = columnMappingFor(["Especie", "Cantidad", "Moneda", ""]);

  it("takes headers the sheet has", () => {
    expect(
      schema.parse({
        symbol: "Especie",
        quantity: "Cantidad",
        price: null,
        value: null,
        currency: "Moneda",
        date: null,
        currencyDefault: "ARS",
      }),
    ).toMatchObject({ symbol: "Especie", currencyDefault: "ARS" });
  });

  it.each([
    ["a header the sheet lacks", { symbol: "Ticker" }],
    ["an empty header", { price: "" }],
    ["a currency it does not know", { currencyDefault: "EUR" }],
    ["an extra field", { page: "Especie" }],
  ])("refuses %s", (_, patch) => {
    expect(
      schema.safeParse({
        symbol: "Especie",
        quantity: "Cantidad",
        price: null,
        value: null,
        currency: null,
        date: null,
        currencyDefault: null,
        ...patch,
      }).success,
    ).toBe(false);
  });
});

describe("sheetToDraft", () => {
  const draftOf = (...args: Parameters<typeof sheetToDraft>) =>
    sheetToDraft(...args).draft;
  const sheet = {
    headers: ["Especie", "Cantidad", "Precio", "Moneda", "Fecha"],
    rows: [
      ["AL30", "1.234", "65.432,10", "Pesos", "30/09/2026"],
      ["AAPL", 10, 230.5, "u$s", 46200],
      ["GD30", "5", "", "Euros", "15/10/2026"],
      ["", "5", "1", "ARS", ""],
      ["GGAL", "", "1", "ARS", ""],
      ["YPFD", "-2", "1", "ARS", ""],
      ["BMA", "3", "-1", "ARS", ""],
    ],
  };

  it("counts the rows with a quantity that make no holding", () => {
    expect(sheetToDraft(sheet, mapping, "2026-10-13").skippedRows).toBe(3);
  });

  it("reads a sheet in US formats", () => {
    const { draft, skippedRows } = sheetToDraft(
      {
        ...sheet,
        rows: [
          ["AAPL", "1,500", "1,234.56", "USD", ""],
          ["MELI", "3", "230.50", "USD", ""],
        ],
      },
      mapping,
      "2026-10-13",
    );
    expect(skippedRows).toBe(0);
    expect(
      draft.rows.map(({ quantity, price, confidence }) => [
        quantity,
        price,
        confidence,
      ]),
    ).toEqual([
      // "1,500" still also reads as one and a half: for the user to check.
      ["1500", "1234.56", "low"],
      ["3", "230.50", "high"],
    ]);
  });

  it("keeps es-AR for a column that shows it, in a sheet that looks US", () => {
    const { draft } = sheetToDraft(
      {
        ...sheet,
        rows: [
          ["AAPL", "2,5", "1,234.56", "USD", ""],
          ["MELI", "1,500", "230.50", "USD", ""],
        ],
      },
      mapping,
      "2026-10-13",
    );
    expect(draft.rows.map((row) => row.quantity)).toEqual(["2.5", "1.500"]);
  });

  it("keeps the rows that make a holding and the latest date up to today", () => {
    expect(draftOf(sheet, mapping, "2026-10-13")).toEqual({
      documentDate: "2026-09-30",
      rows: [
        // "1.234" also reads as one and a fraction: for the user to check.
        {
          symbol: "AL30",
          quantity: "1234",
          price: "65432.10",
          value: null,
          currency: "ARS",
          confidence: "low",
          page: null,
        },
        {
          symbol: "AAPL",
          quantity: "10",
          price: "230.5",
          value: null,
          currency: "USD",
          confidence: "high",
          page: null,
        },
        // A price that is not a positive amount is left out, not the row.
        {
          symbol: "BMA",
          quantity: "3",
          price: null,
          value: null,
          currency: "ARS",
          confidence: "high",
          page: null,
        },
      ],
      totals: [],
    });
  });

  it("marks a comma that also reads as thousands for the user to check", () => {
    const { rows } = draftOf(
      { ...sheet, rows: [["AAPL", "1,500", "", "ARS", ""]] },
      mapping,
      "2026-10-13",
    );
    expect(rows).toEqual([
      expect.objectContaining({ quantity: "1.500", confidence: "low" }),
    ]);
  });

  it.each(["US$ 1,500", "$ 1.500"])(
    "checks %j as it reads it, after its currency mark",
    (price) => {
      const { rows } = draftOf(
        { ...sheet, rows: [["AAPL", "10", price, "ARS", ""]] },
        mapping,
        "2026-10-13",
      );
      expect(rows).toEqual([expect.objectContaining({ confidence: "low" })]);
    },
  );

  it("falls back to the default currency", () => {
    const { rows } = draftOf(
      sheet,
      { ...mapping, currency: null, currencyDefault: "USD" },
      "2026-10-13",
    );
    expect(rows.map((row) => [row.symbol, row.currency])).toEqual([
      ["AL30", "USD"],
      ["AAPL", "USD"],
      ["GD30", "USD"],
      ["BMA", "USD"],
    ]);
  });

  it("has no date without a date column", () => {
    expect(
      draftOf(sheet, { ...mapping, date: null }, "2026-10-13").documentDate,
    ).toBeNull();
  });

  it("takes at most DRAFT_ROW_LIMIT rows of a long XLSX", () => {
    const long = XLSX.utils.aoa_to_sheet([
      ["Especie", "Cantidad", "Precio", "Moneda", "Fecha"],
      ...Array.from({ length: 600 }, (_, i) => [
        `S${i}`,
        i + 1,
        1.5,
        "ARS",
        "",
      ]),
    ]);
    const { rows } = draftOf(
      readSheet(xlsxOf(long), XLSX_TYPE),
      mapping,
      "2026-10-13",
    );
    expect(rows).toHaveLength(DRAFT_ROW_LIMIT);
    expect(rows.at(-1)).toMatchObject({ symbol: "S499", quantity: "500" });
  });
});

it("counts as skipped only rows with a quantity, not titles or totals", () => {
  const { skippedRows, draft } = sheetToDraft(
    {
      headers: ["Especie", "Cantidad", "Precio", "Moneda", "Fecha"],
      rows: [
        ["Acciones", "", "", "", ""],
        ["GGAL", "10", "1.500,50", "ARS", ""],
        ["Total", "", "", "", ""],
        ["YPFD", "abc", "1", "ARS", ""],
      ],
    },
    mapping,
    "2026-10-13",
  );
  expect(draft.rows).toHaveLength(1);
  expect(skippedRows).toBe(1);
});

it("takes no convention from a note in a figure column", () => {
  expect(numberConventionOf(["Precios al 10/14, 12", "1,234.56"])).toBe("US");
});
