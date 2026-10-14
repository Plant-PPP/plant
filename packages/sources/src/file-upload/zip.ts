import { inflateRawSync } from "node:zlib";

// What SheetJS unzips is held in memory before the row limit applies. A real
// holdings workbook unzips to well under a megabyte; 50 MB leaves room for an
// upload at the 20 MB limit that compresses little, and keeps what SheetJS
// then builds from the XML within the function's memory.
export const WORKBOOK_UNZIPPED_LIMIT = 50 * 1024 * 1024;
// A workbook has a few files per sheet.
export const WORKBOOK_ENTRY_LIMIT = 1000;

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const ZIP64_EXTRA = 0x0001;
const DEFLATE = 8;
const ZIP64_MARK = 0xffffffff;

// SheetJS reads a file as a zip on these first bytes.
export const isZip = (bytes: Uint8Array) =>
  bytes[0] === 0x50 &&
  bytes[1] === 0x4b &&
  (bytes[2] ?? 9) < 9 &&
  (bytes[3] ?? 9) < 9;

const hasZip64Extra = (extra: Uint8Array) => {
  const view = new DataView(extra.buffer, extra.byteOffset, extra.byteLength);
  for (
    let at = 0;
    at + 4 <= extra.length;
    at += 4 + view.getUint16(at + 2, true)
  ) {
    if (view.getUint16(at, true) === ZIP64_EXTRA) return true;
  }
  return false;
};

// Whether a zip unzips within the limit, as SheetJS 0.20.3 would unzip it: it
// walks the central directory of the last end record, allocates each entry's
// size as its local header declares it, without bound when that size is 0 as
// a data descriptor leaves it, and inflates every stream to its end whatever
// the size. ZIP64 is refused.
export function zipFitsLimit(bytes: Uint8Array): boolean {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (at: number) => view.getUint16(at, true);
  const u32 = (at: number) => view.getUint32(at, true);
  const within = (at: number, length: number) =>
    at >= 0 && at + length <= bytes.length;

  let end = bytes.length - 4;
  while (end >= 0 && u32(end) !== EOCD) end -= 1;
  if (!within(end, 22)) return false;
  const entries = u16(end + 8);
  let at = u32(end + 16);
  if (entries > WORKBOOK_ENTRY_LIMIT || at === ZIP64_MARK) return false;

  let compressed = 0;
  let unzipped = 0;
  const offsets = new Set<number>();
  for (let entry = 0; entry < entries; entry += 1) {
    if (!within(at, 46) || u32(at) !== CENTRAL) return false;
    const size = u32(at + 20);
    const usize = u32(at + 24);
    const nameLength = u16(at + 28);
    const extraLength = u16(at + 30);
    const offset = u32(at + 42);
    const next = at + 46 + nameLength + extraLength + u16(at + 32);
    if (!within(at, next - at)) return false;
    const extra = bytes.subarray(
      at + 46 + nameLength,
      at + 46 + nameLength + extraLength,
    );
    if (
      [size, usize, offset].includes(ZIP64_MARK) ||
      hasZip64Extra(extra) ||
      !within(offset, 30) ||
      u32(offset) !== LOCAL
    ) {
      return false;
    }
    const localExtraLength = u16(offset + 28);
    const data = offset + 30 + u16(offset + 26) + localExtraLength;
    if (
      !within(data, size) ||
      hasZip64Extra(bytes.subarray(data - localExtraLength, data))
    ) {
      return false;
    }
    // Two entries on one local header would make SheetJS inflate it twice.
    if (offsets.has(offset)) return false;
    offsets.add(offset);
    const localSize = u32(offset + 18);
    const localUsize = u32(offset + 22);
    const descriptor = localUsize === 0;
    if (!descriptor && (localSize !== size || localUsize !== usize)) {
      return false;
    }
    // The totals are checked before anything is inflated, so an entry that
    // declares more than the limit is refused without inflating it.
    // SheetJS copies each entry's compressed bytes too.
    compressed += size;
    unzipped += usize;
    if (compressed > bytes.length || unzipped > WORKBOOK_UNZIPPED_LIMIT) {
      return false;
    }
    // SheetJS inflates a stream to its end whatever size the headers give,
    // so every deflated entry is inflated here once, within its compressed
    // bytes and its declared size: one that runs past either, or never ends,
    // is refused.
    if (u16(offset + 8) === DEFLATE) {
      try {
        const inflated = inflateRawSync(bytes.subarray(data, data + size), {
          maxOutputLength: Math.max(usize, 1),
        });
        if (inflated.length !== usize) return false;
      } catch {
        return false;
      }
    } else if (descriptor && localSize !== size) {
      return false;
    }
    at = next;
  }
  return true;
}
