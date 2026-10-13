import {
  bytesMatch,
  cleanFileName,
  uploadPath,
  uploadPathProblem,
  uploadTypeOf,
} from "./upload";

const bytes = (...parts: (string | number[])[]) =>
  new Uint8Array(
    parts.flatMap((part) =>
      typeof part === "string" ? [...new TextEncoder().encode(part)] : part,
    ),
  );

describe("uploadTypeOf", () => {
  it.each([
    ["Resumen.PDF", "application/pdf"],
    ["foto.jpeg", "image/jpeg"],
    ["captura.heic", "image/heic"],
    ["movimientos.csv", "text/csv"],
    [
      "tenencias.xlsx",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ],
    ["viejo.xls", "application/vnd.ms-excel"],
  ])("reads %s as %s", (name, type) => {
    expect(uploadTypeOf(name)).toBe(type);
  });

  it.each(["virus.exe", "pdf", "sin-extension", "doc.pdf.zip"])(
    "takes no %s",
    (name) => {
      expect(uploadTypeOf(name)).toBeNull();
    },
  );
});

describe("bytesMatch", () => {
  it.each([
    ["application/pdf", bytes("%PDF-1.7\n")],
    ["image/png", bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])],
    ["image/jpeg", bytes([0xff, 0xd8, 0xff, 0xe0])],
    ["image/webp", bytes("RIFF", [1, 2, 3, 4], "WEBPVP8 ")],
    ["image/heic", bytes([0, 0, 0, 0x18], "ftypheic")],
    ["text/csv", bytes([0xef, 0xbb, 0xbf], "Especie;Cantidad\r\nAAPL;5\n")],
    [
      "application/vnd.ms-excel",
      bytes([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
    ],
    [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      bytes([0x50, 0x4b, 0x03, 0x04]),
    ],
  ] as const)("takes a real %s", (type, file) => {
    expect(bytesMatch(type, file)).toBe(true);
  });

  it("refuses a file renamed to another type", () => {
    const exe = bytes("MZ", [0x90, 0, 3, 0]);
    expect(bytesMatch("application/pdf", exe)).toBe(false);
    expect(bytesMatch("text/csv", exe)).toBe(false);
    expect(bytesMatch("image/png", bytes("%PDF-1.7"))).toBe(false);
  });

  it("takes a CSV whose head cuts a character, but not one that is not UTF-8", () => {
    const long = bytes("a".repeat(4095), [0xc3, 0xb1]);
    expect(bytesMatch("text/csv", long)).toBe(true);
    expect(bytesMatch("text/csv", bytes("a;b\n", [0xff, 0xfe]))).toBe(false);
    expect(bytesMatch("text/csv", bytes(""))).toBe(false);
  });
});

describe("cleanFileName", () => {
  it("keeps the name without its folders or control characters", () => {
    expect(cleanFileName("C:\\Users\\ana\\resumen\u0007.pdf")).toBe(
      "resumen.pdf",
    );
    expect(cleanFileName("../../etc/passwd")).toBe("passwd");
    expect(cleanFileName("  \u0000 ")).toBeNull();
    expect(cleanFileName(`${"a".repeat(300)}.pdf`)).toHaveLength(255);
  });
});

describe("uploadPathProblem", () => {
  const userId = "a0000000-0000-4000-8000-00000000000a";
  const uploadId = "a9000000-0000-4000-8000-0000000000a9";
  const objectId = "a7000000-0000-4000-8000-0000000000a7";

  it("takes the path the upload was given", () => {
    expect(
      uploadPathProblem(uploadPath(userId, uploadId, objectId), {
        userId,
        uploadId,
      }),
    ).toBeNull();
  });

  it.each([
    [`${userId}/imports/${uploadId}`, "segments"],
    [
      `b0000000-0000-4000-8000-00000000000b/imports/${uploadId}/${objectId}`,
      "owner",
    ],
    [`${userId}/other/${uploadId}/${objectId}`, "folder"],
    [`${userId}/imports/${objectId}/${objectId}`, "upload"],
    [`${userId}/imports/${uploadId}/..`, "object"],
  ])("refuses %s: %s", (path, problem) => {
    expect(uploadPathProblem(path, { userId, uploadId })).toBe(problem);
  });
});
