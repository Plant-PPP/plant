import {
  createSourceForConnection,
  sourceCapabilitiesSchema,
  type SourceInput,
  type SourceReading,
} from "../port";
import { FILE_TYPE_READERS, fileUploadSource } from "./adapter";
import { SourceError } from "./draft";

const input = (mimeType: string): SourceInput => ({
  bytes: new Uint8Array(),
  mimeType,
  userId: "u1",
  importId: "i1",
  institution: "IOL",
  lastAttempt: false,
});

const reading = (reader: "document" | "sheet"): SourceReading => ({
  draft: { documentDate: null, rows: [], totals: [] },
  read: {
    reader,
    mapping: "none",
    skippedRows: 0,
    disputes: 0,
    documentKind: null,
  },
});

const readers = () => ({
  document: jest.fn(async () => reading("document")),
  sheet: jest.fn(async () => reading("sheet")),
});

describe("fileUploadSource", () => {
  it.each(Object.entries(FILE_TYPE_READERS))(
    "hands %s to the %s reader",
    async (mimeType, reader) => {
      const each = readers();
      const source = fileUploadSource(each);
      expect((await source.read(input(mimeType))).read.reader).toBe(reader);
      expect(each[reader]).toHaveBeenCalledWith(input(mimeType));
    },
  );

  it.each(["application/zip", "toString", "__proto__"])(
    "refuses %s as unsupported without reading it",
    async (mimeType) => {
      const each = readers();
      await expect(
        fileUploadSource(each).read(input(mimeType)),
      ).rejects.toMatchObject({ code: "unsupported", retryable: false });
      expect(each.document).not.toHaveBeenCalled();
      expect(each.sheet).not.toHaveBeenCalled();
    },
  );

  it("passes a reader's failure on as it is", async () => {
    const error = new SourceError("extraction_failed", true);
    const source = fileUploadSource({
      document: jest.fn().mockRejectedValue(error),
      sheet: jest.fn(),
    });
    await expect(source.read(input("application/pdf"))).rejects.toBe(error);
  });

  it("reads holdings, not movements or changes since a cursor", () => {
    const capabilities = fileUploadSource(readers()).capabilities();
    expect(sourceCapabilitiesSchema.parse(capabilities)).toEqual({
      holdings: "native",
      movements: "unsupported",
      incremental: "unsupported",
    });
  });
});

describe("createSourceForConnection", () => {
  it("builds the adapter for the connection's kind", () => {
    const source = fileUploadSource(readers());
    const build = jest.fn(() => source);
    expect(
      createSourceForConnection(
        { kind: "file_upload" },
        { file_upload: build },
      ),
    ).toBe(source);
    expect(build).toHaveBeenCalledTimes(1);
  });
});
