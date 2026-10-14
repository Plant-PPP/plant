import { deflateRawSync, inflateRawSync } from "node:zlib";

import * as XLSX from "xlsx";

import {
  isZip,
  WORKBOOK_ENTRY_LIMIT,
  WORKBOOK_UNZIPPED_LIMIT,
  zipFitsLimit,
} from "./zip";

jest.mock("node:zlib", () => {
  const actual = jest.requireActual<typeof import("node:zlib")>("node:zlib");
  return { ...actual, inflateRawSync: jest.fn(actual.inflateRawSync) };
});

type Entry = {
  name?: string;
  content: Uint8Array;
  // What the central directory and the local header declare, when not the
  // content's own size; a data descriptor leaves the local sizes at 0.
  centralUsize?: number;
  localUsize?: number;
  descriptor?: boolean;
  centralExtra?: Uint8Array;
};

const zipOf = (entries: readonly Entry[]) => {
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  entries.forEach((entry, index) => {
    const name = new TextEncoder().encode(entry.name ?? `xl/part${index}.xml`);
    const data = deflateRawSync(entry.content);
    const usize = entry.content.length;
    const local = new Uint8Array(30 + name.length + data.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, entry.descriptor ? 8 : 0, true);
    lv.setUint16(8, 8, true);
    lv.setUint32(18, entry.descriptor ? 0 : data.length, true);
    lv.setUint32(22, entry.descriptor ? 0 : (entry.localUsize ?? usize), true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    local.set(data, 30 + name.length);
    const extra = entry.centralExtra ?? new Uint8Array();
    const central = new Uint8Array(46 + name.length + extra.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, entry.descriptor ? 8 : 0, true);
    cv.setUint16(10, 8, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, entry.centralUsize ?? usize, true);
    cv.setUint16(28, name.length, true);
    cv.setUint16(30, extra.length, true);
    cv.setUint32(42, offset, true);
    central.set(name, 46);
    central.set(extra, 46 + name.length);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  });
  const directorySize = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, directorySize, true);
  ev.setUint32(16, offset, true);
  const zip = new Uint8Array(offset + directorySize + 22);
  let at = 0;
  for (const part of [...locals, ...centrals, end]) {
    zip.set(part, at);
    at += part.length;
  }
  return zip;
};

const text = (length: number) => new Uint8Array(length).fill(0x61);

const workbook = () => {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    book,
    XLSX.utils.aoa_to_sheet([["Especie"], ["AL30"]]),
    "Tenencias",
  );
  return new Uint8Array(
    XLSX.write(book, { type: "array", bookType: "xlsx" }) as ArrayBuffer,
  );
};

describe("zipFitsLimit", () => {
  it("takes a workbook SheetJS writes", () => {
    const bytes = workbook();
    expect(isZip(bytes)).toBe(true);
    expect(zipFitsLimit(bytes)).toBe(true);
  });

  it("takes entries whose sizes agree and fit", () => {
    expect(
      zipFitsLimit(zipOf([{ content: text(1000) }, { content: text(10) }])),
    ).toBe(true);
  });

  it("refuses a central directory that declares more than the limit", () => {
    expect(
      zipFitsLimit(
        zipOf([
          {
            content: text(10),
            centralUsize: WORKBOOK_UNZIPPED_LIMIT + 1,
            localUsize: WORKBOOK_UNZIPPED_LIMIT + 1,
          },
        ]),
      ),
    ).toBe(false);
  });

  it("refuses an entry declaring more than the limit before inflating it", () => {
    // A real bomb: zeros past the limit, deflated to a few kilobytes.
    const bomb = zipOf([
      { content: new Uint8Array(WORKBOOK_UNZIPPED_LIMIT + 1) },
    ]);
    jest.mocked(inflateRawSync).mockClear();
    expect(zipFitsLimit(bomb)).toBe(false);
    expect(inflateRawSync).not.toHaveBeenCalled();
  });

  it("refuses entries that only together pass the limit", () => {
    const entry = { content: text(WORKBOOK_UNZIPPED_LIMIT / 2 + 1) };
    expect(zipFitsLimit(zipOf([entry]))).toBe(true);
    expect(zipFitsLimit(zipOf([entry, entry]))).toBe(false);
  });

  it("refuses an entry that inflates past the size its headers declare", () => {
    expect(
      zipFitsLimit(
        zipOf([{ content: text(5000), centralUsize: 100, localUsize: 100 }]),
      ),
    ).toBe(false);
  });

  it("refuses two entries on one local header", () => {
    const zip = zipOf([{ content: text(10) }, { content: text(10) }]);
    const view = new DataView(zip.buffer);
    const centrals = [...zip.keys()].filter(
      (at) => at + 4 <= zip.length && view.getUint32(at, true) === 0x02014b50,
    );
    view.setUint32(centrals[1]! + 42, 0, true);
    expect(zipFitsLimit(zip)).toBe(false);
  });

  it("refuses a local header that declares other than the central directory", () => {
    expect(
      zipFitsLimit(zipOf([{ content: text(10), localUsize: 0x7fffffff }])),
    ).toBe(false);
  });

  it("checks what a data descriptor's entry really inflates to", () => {
    expect(
      zipFitsLimit(zipOf([{ content: text(5000), descriptor: true }])),
    ).toBe(true);
    expect(
      zipFitsLimit(
        zipOf([{ content: text(5000), descriptor: true, centralUsize: 100 }]),
      ),
    ).toBe(false);
  });

  it("refuses a Numbers package", () => {
    expect(
      zipFitsLimit(zipOf([{ name: "Index/Document.IWA", content: text(10) }])),
    ).toBe(false);
  });

  it("refuses a ZIP64 extra field", () => {
    const extra = new Uint8Array([0x01, 0x00, 0x00, 0x00]);
    expect(
      zipFitsLimit(zipOf([{ content: text(10), centralExtra: extra }])),
    ).toBe(false);
  });

  it("refuses more entries than the limit", () => {
    const entries = Array.from({ length: WORKBOOK_ENTRY_LIMIT + 1 }, () => ({
      content: text(1),
    }));
    expect(zipFitsLimit(zipOf(entries.slice(1)))).toBe(true);
    expect(zipFitsLimit(zipOf(entries))).toBe(false);
  });

  it.each([
    [
      "cut before its end record",
      (bytes: Uint8Array) => bytes.subarray(0, bytes.length - 30),
    ],
    [
      "cut inside its central directory",
      (bytes: Uint8Array) => {
        const cut = bytes.slice();
        new DataView(cut.buffer).setUint32(cut.length - 6, cut.length, true);
        return cut;
      },
    ],
    ["only its first bytes", (bytes: Uint8Array) => bytes.subarray(0, 4)],
  ])("refuses a zip %s", (_, damage) => {
    expect(zipFitsLimit(damage(workbook()))).toBe(false);
  });
});
