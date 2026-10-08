import { buildCsp, createNonce } from "./csp";

function directive(csp: string, name: string): string[] {
  const found = csp.split("; ").find((d) => d.startsWith(`${name} `));
  return found ? found.split(" ").slice(1) : [];
}

const base = { nonce: "abc", connectOrigins: [] };

it("allows only same-origin and nonced scripts", () => {
  expect(directive(buildCsp({ ...base, dev: false }), "script-src")).toEqual([
    "'self'",
    "'nonce-abc'",
  ]);
});

it("allows eval only in development", () => {
  expect(directive(buildCsp({ ...base, dev: true }), "script-src")).toContain(
    "'unsafe-eval'",
  );
});

it("blocks framing, plugins and foreign base URLs", () => {
  const csp = buildCsp({ ...base, dev: false });
  expect(directive(csp, "frame-ancestors")).toEqual(["'none'"]);
  expect(directive(csp, "object-src")).toEqual(["'none'"]);
  expect(directive(csp, "base-uri")).toEqual(["'self'"]);
});

it("keeps every other source and form target same-origin", () => {
  const csp = buildCsp({ ...base, dev: false });
  expect(directive(csp, "default-src")).toEqual(["'self'"]);
  expect(directive(csp, "form-action")).toEqual(["'self'"]);
  expect(directive(csp, "img-src")).toEqual(["'self'", "data:", "blob:"]);
  expect(directive(csp, "font-src")).toEqual(["'self'"]);
  expect(directive(csp, "style-src")).toEqual(["'self'", "'unsafe-inline'"]);
});

// A directive added later (script-src-elem, worker-src) would override or
// widen the ones pinned above without failing them.
it("sets only these directives", () => {
  const names = buildCsp({ ...base, dev: false })
    .split("; ")
    .map((d) => d.split(" ")[0]);
  expect(names.sort()).toEqual(
    [
      "base-uri",
      "connect-src",
      "default-src",
      "font-src",
      "form-action",
      "frame-ancestors",
      "img-src",
      "object-src",
      "script-src",
      "style-src",
    ].sort(),
  );
});

it("lets the browser reach the given origins", () => {
  const csp = buildCsp({
    ...base,
    connectOrigins: ["https://x.supabase.co"],
    dev: false,
  });
  expect(directive(csp, "connect-src")).toEqual([
    "'self'",
    "https://x.supabase.co",
  ]);
});

it("creates a fresh 128-bit nonce each time", () => {
  const a = createNonce();
  expect(a).toMatch(/^[A-Za-z0-9+/]{22}==$/);
  expect(createNonce()).not.toBe(a);
});
