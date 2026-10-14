jest.mock("server-only", () => ({}), { virtual: true });

import {
  type FaviconDeps,
  FaviconError,
  fetchFavicon,
  iconLinks,
  isPrivateAddress,
  siteUrl,
} from "./favicon";
import { isStoredIcon } from "./icon-data";

const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13,
]);
const ICO = new Uint8Array([0, 0, 1, 0, 1, 0, 16, 16]);

it("tells public addresses from every private, local or reserved one", () => {
  for (const address of [
    "127.0.0.1",
    "10.1.2.3",
    "172.31.255.255",
    "192.168.0.10",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "::",
    "::1",
    "fd00::1",
    "fe80::1",
    "ff02::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "64:ff9b::a9fe:a9fe",
    "2001:db8::1",
    "not an address",
  ]) {
    expect([address, isPrivateAddress(address)]).toEqual([address, true]);
  }
  for (const address of [
    "8.8.8.8",
    "172.32.0.1",
    "2800:3f0:4002::200e",
    "::ffff:8.8.8.8",
  ]) {
    expect([address, isPrivateAddress(address)]).toEqual([address, false]);
  }
});

it("reads a site the user typed as https only", () => {
  expect(siteUrl("www.naranjax.com")?.href).toBe("https://www.naranjax.com/");
  expect(siteUrl("https://brubank.com/x")?.hostname).toBe("brubank.com");
  for (const text of [
    "http://brubank.com",
    "ftp://brubank.com",
    "https://user:pass@brubank.com",
    "https://brubank.com:8443",
    "https://localhost",
    "",
    "javascript:alert(1)",
  ]) {
    expect([text, siteUrl(text)]).toEqual([text, null]);
  }
});

it("finds the icons a page names, never an SVG", () => {
  const base = new URL("https://brubank.com/");
  expect(
    iconLinks(
      `<link rel="stylesheet" href="/a.css"><link rel="icon" type="image/svg+xml" href="/i.svg">
       <LINK REL='shortcut icon' HREF='/static/fav.png?v=2&amp;x=1'>
       <link href="https://cdn.brubank.com/apple.png" rel="apple-touch-icon">`,
      base,
    ).map((url) => url.href),
  ).toEqual([
    "https://brubank.com/static/fav.png?v=2&x=1",
    "https://cdn.brubank.com/apple.png",
  ]);
});

// A fake web: each URL answers with a status, headers and a body.
function web(
  pages: Record<
    string,
    {
      status?: number;
      headers?: Record<string, string>;
      body?: Uint8Array | string;
    }
  >,
  addresses: Record<string, string[]> = {},
): FaviconDeps & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    lookup: async (host) => addresses[host] ?? ["8.8.8.8"],
    fetch: (async (input: URL) => {
      asked.push(input.href);
      const page = pages[input.href];
      if (!page) return new Response(null, { status: 404 });
      return new Response((page.body ?? null) as BodyInit | null, {
        status: page.status ?? 200,
        headers: page.headers,
      });
    }) as typeof fetch,
  };
}

it("takes the icon the page names, as a data URL", async () => {
  const deps = web({
    "https://brubank.com/": { body: '<link rel="icon" href="/fav.png">' },
    "https://brubank.com/fav.png": { body: PNG },
  });
  const icon = await fetchFavicon("brubank.com", deps);
  expect(icon).toBe(
    `data:image/png;base64,${Buffer.from(PNG).toString("base64")}`,
  );
  expect(isStoredIcon(icon)).toBe(true);
});

it("falls back to /favicon.ico", async () => {
  const deps = web({
    "https://brubank.com/": { body: "<html></html>" },
    "https://brubank.com/favicon.ico": { body: ICO },
  });
  expect(await fetchFavicon("https://brubank.com", deps)).toMatch(
    /^data:image\/x-icon;base64,/,
  );
});

it("reads the icon links at the start of a page too long to read whole", async () => {
  const deps = web({
    "https://nexo.com/": {
      body: `<link rel="icon" href="/big.ico"><link rel="apple-touch-icon" href="/apple.png">${"x".repeat(600 * 1024)}`,
    },
    "https://nexo.com/big.ico": { body: new Uint8Array(70 * 1024) },
    "https://nexo.com/apple.png": { body: PNG },
  });
  expect(await fetchFavicon("nexo.com", deps)).toMatch(
    /^data:image\/png;base64,/,
  );
});

it("refuses a page that is an image over the cap", async () => {
  const big = new Uint8Array(300 * 1024);
  big.set(PNG);
  const deps = web({ "https://brubank.com/": { body: big } });
  await expect(fetchFavicon("brubank.com", deps)).rejects.toEqual(
    new FaviconError("too_large"),
  );
});

it("tries /favicon.ico even when the page names many icons", async () => {
  const deps = web({
    "https://brubank.com/": {
      body: ["a", "b", "c", "d", "e"]
        .map((name) => `<link rel="apple-touch-icon" href="/${name}.png">`)
        .join(""),
    },
    "https://brubank.com/favicon.ico": { body: ICO },
  });
  expect(await fetchFavicon("brubank.com", deps)).toMatch(
    /^data:image\/x-icon;base64,/,
  );
});

it("refuses a redirect to another port", async () => {
  const deps = web({
    "https://brubank.com/": {
      status: 302,
      headers: { location: "https://brubank.com:8443/" },
    },
  });
  await expect(fetchFavicon("brubank.com", deps)).rejects.toEqual(
    new FaviconError("url"),
  );
  expect(deps.asked).toEqual(["https://brubank.com/"]);
});

it("refuses a host whose lookup answers a mapped or translated private address", async () => {
  for (const address of ["::ffff:127.0.0.1", "64:ff9b::a9fe:a9fe", "FE80::1"]) {
    const deps = web({}, { "brubank.com": [address] });
    await expect(fetchFavicon("brubank.com", deps)).rejects.toEqual(
      new FaviconError("private"),
    );
  }
});

it("gives up when the whole read passes its deadline", async () => {
  const deps = web({});
  deps.lookup = () => new Promise(() => undefined);
  await expect(
    fetchFavicon("brubank.com", deps, AbortSignal.timeout(50)),
  ).rejects.toEqual(new FaviconError("unreachable"));
});

it("refuses a host that resolves to a private address", async () => {
  const deps = web(
    { "https://intranet.example.com/favicon.ico": { body: ICO } },
    { "intranet.example.com": ["93.184.216.34", "10.0.0.5"] },
  );
  await expect(fetchFavicon("intranet.example.com", deps)).rejects.toEqual(
    new FaviconError("private"),
  );
  expect(deps.asked).toEqual([]);
});

it("refuses a redirect to a private address", async () => {
  const deps = web(
    {
      "https://brubank.com/": {
        status: 302,
        headers: { location: "https://metadata.internal/latest" },
      },
    },
    { "metadata.internal": ["169.254.169.254"] },
  );
  await expect(fetchFavicon("brubank.com", deps)).rejects.toEqual(
    new FaviconError("private"),
  );
  expect(deps.asked).toEqual(["https://brubank.com/"]);
});

it("refuses a redirect to http", async () => {
  const deps = web({
    "https://brubank.com/": { body: '<link rel="icon" href="/fav.png">' },
    "https://brubank.com/fav.png": {
      status: 301,
      headers: { location: "http://brubank.com/fav.png" },
    },
  });
  await expect(fetchFavicon("brubank.com", deps)).rejects.toBeInstanceOf(
    FaviconError,
  );
  expect(deps.asked).not.toContain("http://brubank.com/fav.png");
});

it("refuses a site whose icons are not images", async () => {
  const deps = web({
    "https://brubank.com/": { body: '<link rel="icon" href="/fav.png">' },
    "https://brubank.com/fav.png": { body: "<html>not found</html>" },
    "https://brubank.com/favicon.ico": { body: "<svg onload=alert(1)>" },
  });
  await expect(fetchFavicon("brubank.com", deps)).rejects.toEqual(
    new FaviconError("not_image"),
  );
});

it("refuses an icon over the cap", async () => {
  const big = new Uint8Array(70 * 1024);
  big.set(PNG);
  const deps = web({
    "https://brubank.com/": { body: "" },
    "https://brubank.com/favicon.ico": { body: big },
  });
  await expect(fetchFavicon("brubank.com", deps)).rejects.toEqual(
    new FaviconError("too_large"),
  );
});

it("keeps only data URLs of images it shows", () => {
  const png = Buffer.from(PNG).toString("base64");
  expect(isStoredIcon(`data:image/png;base64,${png}`)).toBe(true);
  expect(isStoredIcon(`data:image/jpeg;base64,${png}`)).toBe(false);
  expect(isStoredIcon(`data:image/svg+xml;base64,${png}`)).toBe(false);
  expect(isStoredIcon("https://brubank.com/fav.png")).toBe(false);
});
