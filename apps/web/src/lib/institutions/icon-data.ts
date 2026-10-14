// An account's icon as Plant stores it: a data URL of an image of at most
// ICON_MAX_BYTES, of a kind it shows.
export const ICON_MAX_BYTES = 64 * 1024;

// The kind of image the bytes are, by their first bytes; null if none Plant
// shows. SVG is left out: it may carry script.
export function imageType(bytes: Uint8Array): string | null {
  const starts = (...prefix: number[]) =>
    prefix.every((byte, index) => bytes[index] === byte);
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) {
    return "image/png";
  }
  if (starts(0x00, 0x00, 0x01, 0x00)) return "image/x-icon";
  if (starts(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (starts(0x47, 0x49, 0x46, 0x38)) return "image/gif";
  if (
    starts(0x52, 0x49, 0x46, 0x46) &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

const STORED =
  /^data:(image\/(?:png|x-icon|jpeg|gif|webp));base64,([A-Za-z0-9+/]+={0,2})$/;

// Whether a data URL is one Plant stores as an account's icon: base64 of one
// of the kinds it shows, within the cap, whose bytes are that kind.
export function isStoredIcon(icon: string): boolean {
  const match = STORED.exec(icon);
  if (!match) return false;
  let binary: string;
  try {
    binary = atob(match[2]!);
  } catch {
    return false;
  }
  if (binary.length > ICON_MAX_BYTES) return false;
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return imageType(bytes) === match[1];
}
