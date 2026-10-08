import { AuthApiError } from "@supabase/supabase-js";
import { NextRequest } from "next/server";

type GetClaims = (cookies: {
  setAll: (
    cookies: { name: string; value: string; options: object }[],
    headers: Record<string, string>,
  ) => void;
}) => Promise<{ data: { claims: object } | null; error: unknown }>;

let getClaims: GetClaims;

jest.mock("@supabase/ssr", () => ({
  createServerClient: (
    _url: string,
    _key: string,
    options: { cookies: never },
  ) => ({
    auth: { getClaims: () => getClaims(options.cookies) },
  }),
}));

import { proxy } from "./proxy";

const CACHE_HEADERS = {
  "Cache-Control": "private, no-cache, no-store, must-revalidate, max-age=0",
  Expires: "0",
  Pragma: "no-cache",
};

const ENV = {
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
};

beforeEach(() => Object.assign(process.env, ENV));
afterEach(() => {
  for (const key of Object.keys(ENV)) delete process.env[key];
});

function request(path: string, headers: Record<string, string> = {}) {
  return new NextRequest(new URL(path, "http://localhost:3000"), { headers });
}

// What NextResponse.next({ request: { headers } }) forwards to the page.
function forwarded(res: Response, name: string) {
  return res.headers.get(`x-middleware-request-${name}`);
}

const signedIn: GetClaims = async () => ({
  data: { claims: { sub: "u" } },
  error: null,
});

it("sends a signed-out visitor to /login with the refresh's cookies and headers", async () => {
  getClaims = async ({ setAll }) => {
    setAll(
      [{ name: "sb-x-auth-token", value: "", options: { maxAge: 0 } }],
      CACHE_HEADERS,
    );
    return { data: null, error: null };
  };
  const res = await proxy(request("/assets"));
  expect(res.status).toBe(307);
  expect(res.headers.get("location")).toBe(
    "http://localhost:3000/login?next=%2Fassets",
  );
  expect(res.headers.get("set-cookie")).toContain("sb-x-auth-token=");
  for (const [key, value] of Object.entries(CACHE_HEADERS)) {
    expect(res.headers.get(key)).toBe(value);
  }
});

it("lets a signed-out visitor see /login", async () => {
  getClaims = async () => ({ data: null, error: null });
  const res = await proxy(request("/login"));
  expect(res.headers.get("location")).toBeNull();
});

it.each([
  ["/login?next=%2Fassets", "http://localhost:3000/assets"],
  ["/login?next=//evil.example", "http://localhost:3000/"],
  ["/login", "http://localhost:3000/"],
])("sends a signed-in user on %s to %s", async (path, location) => {
  getClaims = signedIn;
  const res = await proxy(request(path));
  expect(res.status).toBe(307);
  expect(res.headers.get("location")).toBe(location);
});

it("shows /login's error to a signed-in user", async () => {
  getClaims = signedIn;
  const res = await proxy(request("/login?error=callback"));
  expect(res.headers.get("location")).toBeNull();
});

it("keeps the session when Auth is unavailable", async () => {
  getClaims = async ({ setAll }) => {
    // auth-js removes the session on a non-retryable refresh error.
    setAll(
      [{ name: "sb-x-auth-token", value: "", options: { maxAge: 0 } }],
      CACHE_HEADERS,
    );
    return {
      data: null,
      error: new AuthApiError("rate limit", 429, "over_request_rate_limit"),
    };
  };
  const res = await proxy(
    request("/assets", { cookie: "sb-x-auth-token=original" }),
  );
  expect(res.headers.get("location")).toBeNull();
  expect(res.headers.get("set-cookie")).toBeNull();
  expect(forwarded(res, "x-plant-auth")).toBe("unavailable");
  expect(forwarded(res, "cookie")).toBe("sb-x-auth-token=original");
});

it("does not forward a client's own x-plant-auth", async () => {
  getClaims = signedIn;
  const res = await proxy(
    request("/assets", { "x-plant-auth": "unavailable" }),
  );
  expect(forwarded(res, "x-plant-auth")).toBeNull();
  expect(res.headers.get("x-middleware-override-headers")).not.toContain(
    "x-plant-auth",
  );
});

it("passes through without Supabase", async () => {
  for (const key of Object.keys(ENV)) delete process.env[key];
  getClaims = jest.fn();
  const res = await proxy(request("/assets"));
  expect(res.headers.get("location")).toBeNull();
  expect(getClaims).not.toHaveBeenCalled();
});
