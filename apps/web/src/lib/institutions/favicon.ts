import "server-only";
import { isIP } from "node:net";

import { ICON_MAX_BYTES, imageType } from "./icon-data";

// A site's icon as a data URL, read by Plant's server so no outside service
// learns which institutions a user has. Only https, only hosts that resolve
// to public addresses, every redirect checked again, a short timeout and a
// small cap, and only bytes that are an image. A host that answers one lookup
// with a public address and the connection with a private one (DNS
// rebinding) is not stopped here: fetch does not take the address checked.

const PAGE_MAX_BYTES = 512 * 1024;
const TIMEOUT_MS = 5_000;
const MAX_REDIRECTS = 3;
const MAX_CANDIDATES = 4;

export type FaviconFailure =
  "url" | "private" | "unreachable" | "not_image" | "too_large";

export class FaviconError extends Error {
  constructor(readonly reason: FaviconFailure) {
    super(`favicon failed: ${reason}`);
  }
}

export type FaviconDeps = {
  fetch: typeof fetch;
  // Every address a host name resolves to.
  lookup: (host: string) => Promise<string[]>;
};

const ipv4 = (address: string) => address.split(".").map(Number);

const inV4 = (address: string, base: string, bits: number) => {
  const toInt = (parts: number[]) =>
    parts.reduce((sum, part) => sum * 256 + part, 0);
  const mask = bits === 0 ? 0 : 2 ** 32 - 2 ** (32 - bits);
  return (
    (toInt(ipv4(address)) & mask) >>> 0 === (toInt(ipv4(base)) & mask) >>> 0
  );
};

const PRIVATE_V4: readonly [string, number][] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

// The 16 bytes of an IPv6 address, or null if it does not read as one.
function v6Bytes(address: string): number[] | null {
  let text = address.toLowerCase().replace(/%.*$/, "");
  const tail = /(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (tail) {
    const [a, b, c, d] = ipv4(tail[1]!);
    text =
      text.slice(0, tail.index) +
      `${((a! << 8) | b!).toString(16)}:${((c! << 8) | d!).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - rest.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return null;
  const groups = [...head, ...Array<string>(missing).fill("0"), ...rest];
  const bytes: number[] = [];
  for (const group of groups) {
    const value = Number.parseInt(group, 16);
    if (!/^[0-9a-f]{1,4}$/.test(group) || Number.isNaN(value)) return null;
    bytes.push(value >> 8, value & 255);
  }
  return bytes;
}

// Whether an address is anything but a public one: loopback, private,
// link-local, shared, documentation, multicast or reserved, an IPv4 address
// mapped or translated into IPv6 included. Anything that does not read as an
// address counts as private.
export function isPrivateAddress(address: string): boolean {
  const version = isIP(address.replace(/%.*$/, ""));
  if (version === 4) {
    return PRIVATE_V4.some(([base, bits]) => inV4(address, base, bits));
  }
  if (version !== 6) return true;
  const bytes = v6Bytes(address);
  if (!bytes) return true;
  const zeroes = (from: number, to: number) =>
    bytes.slice(from, to).every((byte) => byte === 0);
  const embedded = bytes.slice(12).join(".");
  // ::, ::1 and the IPv4-compatible ::a.b.c.d.
  if (zeroes(0, 12)) return true;
  // ::ffff:a.b.c.d, and 64:ff9b::a.b.c.d (NAT64).
  if (zeroes(0, 10) && bytes[10] === 255 && bytes[11] === 255) {
    return isPrivateAddress(embedded);
  }
  if (
    bytes[0] === 0x00 &&
    bytes[1] === 0x64 &&
    bytes[2] === 0xff &&
    bytes[3] === 0x9b &&
    zeroes(4, 12)
  ) {
    return isPrivateAddress(embedded);
  }
  const first = bytes[0]!;
  if ((first & 0xfe) === 0xfc) return true; // fc00::/7 unique local
  if (first === 0xfe && (bytes[1]! & 0xc0) === 0x80) return true; // fe80::/10
  if (first === 0xff) return true; // multicast
  if (
    first === 0x20 &&
    bytes[1] === 0x01 &&
    bytes[2] === 0x0d &&
    bytes[3] === 0xb8
  ) {
    return true; // 2001:db8::/32 documentation
  }
  return false;
}

// The URL a user typed for a site, as https with no credentials or other
// port; null when it is not one.
export function siteUrl(text: string): URL | null {
  const trimmed = text.trim();
  if (trimmed === "" || trimmed.length > 200) return null;
  let url: URL;
  try {
    url = new URL(
      /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`,
    );
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password) return null;
  if (url.port !== "" && url.port !== "443") return null;
  if (
    !url.hostname.includes(".") &&
    isIP(url.hostname.replace(/^\[|\]$/g, "")) === 0
  ) {
    return null;
  }
  return url;
}

// The icons a page names in its <link rel="... icon ..."> tags, in order,
// resolved against it.
export function iconLinks(html: string, base: URL): URL[] {
  const links: URL[] = [];
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const rel = /\brel\s*=\s*["']?([^"'>]+)/i.exec(tag)?.[1] ?? "";
    if (!/(^|\s)(icon|apple-touch-icon)(\s|$)/i.test(rel)) continue;
    const href = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag);
    const value = href?.[1] ?? href?.[2] ?? href?.[3];
    if (!value || /\.svg(\?|#|$)/i.test(value)) continue;
    try {
      links.push(new URL(value.replace(/&amp;/g, "&"), base));
    } catch {
      // A link that does not read as a URL is skipped.
    }
  }
  return links;
}

// The body up to `cap` bytes: past it, a page is cut there, since its icon
// links come first, and an icon fails.
async function readCapped(
  response: Response,
  cap: number,
  over: "cut" | "fail",
): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length"));
  if (over === "fail" && Number.isFinite(declared) && declared > cap) {
    throw new FaviconError("too_large");
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (size + value.byteLength > cap) {
      await reader.cancel();
      if (over === "fail") throw new FaviconError("too_large");
      chunks.push(value.subarray(0, cap - size));
      size = cap;
      break;
    }
    size += value.byteLength;
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.byteLength;
  }
  return out;
}

async function checkHost(url: URL, deps: FaviconDeps) {
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new FaviconError("url");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  let addresses: string[];
  try {
    addresses = isIP(host) ? [host] : await deps.lookup(host);
  } catch {
    throw new FaviconError("unreachable");
  }
  if (addresses.length === 0) throw new FaviconError("unreachable");
  if (addresses.some(isPrivateAddress)) throw new FaviconError("private");
}

// A GET of a public https URL, following up to MAX_REDIRECTS redirects, each
// checked again; the body read up to `cap` bytes.
async function getPublic(
  start: URL,
  cap: number,
  over: "cut" | "fail",
  deps: FaviconDeps,
): Promise<{ url: URL; type: string; bytes: Uint8Array }> {
  let url = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await checkHost(url, deps);
    let response: Response;
    try {
      response = await deps.fetch(url, {
        redirect: "manual",
        cache: "no-store",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { accept: "image/*,text/html;q=0.9,*/*;q=0.5" },
      });
    } catch {
      throw new FaviconError("unreachable");
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location) throw new FaviconError("unreachable");
      try {
        url = new URL(location, url);
      } catch {
        throw new FaviconError("unreachable");
      }
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new FaviconError("unreachable");
    }
    let bytes: Uint8Array;
    try {
      bytes = await readCapped(response, cap, over);
    } catch (error) {
      if (error instanceof FaviconError) throw error;
      throw new FaviconError("unreachable");
    }
    return {
      url,
      type: response.headers.get("content-type") ?? "",
      bytes,
    };
  }
  throw new FaviconError("unreachable");
}

const dataUrl = (type: string, bytes: Uint8Array) =>
  `data:${type};base64,${Buffer.from(bytes).toString("base64")}`;

// The icon of the site at `text`: the first image among the icons its page
// names and /favicon.ico. A URL that is not public https, or a site that
// gives no image, fails with why.
export async function fetchFavicon(
  text: string,
  deps: FaviconDeps,
): Promise<string> {
  const site = siteUrl(text);
  if (!site) throw new FaviconError("url");
  const root = new URL("/", site);
  const candidates: URL[] = [];
  let failure: FaviconError | null = null;
  try {
    const page = await getPublic(root, PAGE_MAX_BYTES, "cut", deps);
    const direct = imageType(page.bytes);
    if (direct) return dataUrl(direct, page.bytes);
    candidates.push(
      ...iconLinks(new TextDecoder().decode(page.bytes), page.url),
    );
  } catch (error) {
    if (!(error instanceof FaviconError)) throw error;
    // A private or malformed site gives nothing else to try.
    if (error.reason === "private" || error.reason === "url") throw error;
    failure = error;
  }
  candidates.push(new URL("/favicon.ico", root));
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (seen.has(candidate.href) || seen.size >= MAX_CANDIDATES) continue;
    seen.add(candidate.href);
    try {
      const icon = await getPublic(candidate, ICON_MAX_BYTES, "fail", deps);
      const type = imageType(icon.bytes);
      if (type) return dataUrl(type, icon.bytes);
      failure ??= new FaviconError("not_image");
    } catch (error) {
      if (!(error instanceof FaviconError)) throw error;
      if (error.reason === "private") throw error;
      failure = error;
    }
  }
  throw failure ?? new FaviconError("not_image");
}
