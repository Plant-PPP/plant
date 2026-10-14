import type { FileUploadType } from "@plant/sources";

// What Cargar takes: PDFs, pictures and spreadsheets up to 20 MiB, each
// checked by its first bytes, not by what the browser says it is. The bucket
// and uploaded_documents hold the same list and limit.
export const UPLOAD_MAX_BYTES = 20 * 1024 * 1024;

export const UPLOAD_BUCKET = "imports";

// The types the file_upload source has a reader for.
export type UploadType = FileUploadType;

const startsWith = (bytes: Uint8Array, prefix: readonly number[], at = 0) =>
  bytes.length >= at + prefix.length &&
  prefix.every((byte, index) => bytes[at + index] === byte);

const ascii = (text: string) => [...text].map((char) => char.charCodeAt(0));

// The first bytes of a CSV: text, with no control byte but tab and line
// breaks. Its encoding may be UTF-8 or Windows-1252, which the reader tells
// apart.
function looksLikeText(bytes: Uint8Array): boolean {
  const head = bytes.subarray(0, 4096);
  for (const byte of head) {
    const breakOrTab = byte >= 0x09 && byte <= 0x0d;
    if ((byte < 0x20 && !breakOrTab) || byte === 0x7f) return false;
  }
  return true;
}

// HEIC: an ISO box of type ftyp whose brand is one of HEIF's.
const HEIC_BRANDS = ["heic", "heix", "hevc", "hevx", "mif1", "msf1"];

const TYPES: Record<
  UploadType,
  { extensions: readonly string[]; matches: (bytes: Uint8Array) => boolean }
> = {
  "application/pdf": {
    extensions: ["pdf"],
    matches: (bytes) => startsWith(bytes, ascii("%PDF-")),
  },
  "image/png": {
    extensions: ["png"],
    matches: (bytes) =>
      startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  },
  "image/jpeg": {
    extensions: ["jpg", "jpeg"],
    matches: (bytes) => startsWith(bytes, [0xff, 0xd8, 0xff]),
  },
  "image/webp": {
    extensions: ["webp"],
    matches: (bytes) =>
      startsWith(bytes, ascii("RIFF")) && startsWith(bytes, ascii("WEBP"), 8),
  },
  "image/heic": {
    extensions: ["heic", "heif"],
    matches: (bytes) =>
      startsWith(bytes, ascii("ftyp"), 4) &&
      HEIC_BRANDS.some((brand) => startsWith(bytes, ascii(brand), 8)),
  },
  "text/csv": {
    extensions: ["csv"],
    matches: (bytes) => bytes.length > 0 && looksLikeText(bytes),
  },
  "application/vnd.ms-excel": {
    extensions: ["xls"],
    // An OLE compound file.
    matches: (bytes) =>
      startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
  },
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": {
    extensions: ["xlsx"],
    // A ZIP archive.
    matches: (bytes) => startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]),
  },
};

// The type a file name says, by its extension; null for one Cargar does not
// take.
export function uploadTypeOf(fileName: string): UploadType | null {
  const extension = fileName.split(".").at(-1)?.toLowerCase();
  if (!extension || extension === fileName.toLowerCase()) return null;
  const found = Object.entries(TYPES).find(([, type]) =>
    type.extensions.includes(extension),
  );
  return found ? (found[0] as UploadType) : null;
}

// Whether a file's first bytes are those of `type`.
export const bytesMatch = (type: UploadType, bytes: Uint8Array): boolean =>
  TYPES[type].matches(bytes);

// A file's name as the list shows it: no path, no control character, at most
// 255 characters.
export function cleanFileName(name: string): string | null {
  const base = name.split(/[/\\]/).at(-1) ?? "";
  const clean = base.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return clean === "" ? null : [...clean].slice(0, 255).join("");
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Where an upload's file goes: under its owner's folder, then the upload's.
export const uploadPath = (
  userId: string,
  uploadId: string,
  objectId: string,
): string => `${userId}/imports/${uploadId}/${objectId}`;

// Why a path cannot be the file of `uploadId` for `userId`; null when it is.
export function uploadPathProblem(
  path: string,
  { userId, uploadId }: { userId: string; uploadId: string },
): "segments" | "owner" | "folder" | "upload" | "object" | null {
  const parts = path.split("/");
  if (parts.length !== 4) return "segments";
  const [owner, folder, id, object] = parts as [string, string, string, string];
  if (owner !== userId) return "owner";
  if (folder !== "imports") return "folder";
  if (id !== uploadId || !UUID.test(id)) return "upload";
  if (!UUID.test(object)) return "object";
  return null;
}
