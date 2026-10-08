const BASE = "http://plant.invalid";

// Encoded slashes, backslashes and controls survive URL parsing as path text
// and come back as separators in browsers or proxies that decode again. The
// query and fragment may carry them encoded: they never become the path.
const RAW_UNSAFE = /[\\\x00-\x1f]/;
const ENCODED_UNSAFE = /%(2f|5c|09|0a|0d)/i;

export function pathOf(path: string): string {
  return path.split(/[?#]/, 1)[0] ?? "";
}

// The only way an outside value becomes a same-origin path to redirect to.
export function sanitizeNextPath(raw: unknown): string {
  if (typeof raw !== "string" || !raw.startsWith("/")) return "/";
  if (RAW_UNSAFE.test(raw) || ENCODED_UNSAFE.test(pathOf(raw))) return "/";
  let url: URL;
  try {
    url = new URL(raw, BASE);
  } catch {
    return "/";
  }
  if (url.origin !== BASE || url.pathname.startsWith("//")) return "/";
  return url.pathname + url.search + url.hash;
}
