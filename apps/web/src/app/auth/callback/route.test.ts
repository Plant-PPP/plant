import { NextRequest } from "next/server";

const exchangeCodeForSession = jest.fn();

jest.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { exchangeCodeForSession } }),
}));

import { GET } from "./route";

function callback(query: string, next?: string) {
  const headers: Record<string, string> = {};
  if (next !== undefined)
    headers.cookie = `plant-auth-next=${encodeURIComponent(next)}`;
  return GET(
    new NextRequest(`http://localhost/auth/callback${query}`, { headers }),
  );
}

beforeEach(() => {
  exchangeCodeForSession.mockReset();
  exchangeCodeForSession.mockResolvedValue({ error: null });
});

it.each([
  ["//evil.example", "http://localhost/"],
  ["https://evil.example", "http://localhost/"],
  ["/assets", "http://localhost/assets"],
])("after the exchange, next %p lands on %p", async (next, location) => {
  const res = await callback("?code=abc", next);
  expect(exchangeCodeForSession).toHaveBeenCalledWith("abc");
  expect(res.headers.get("location")).toBe(location);
});

it.each([
  ["?code=abc", "callback", true],
  ["", "callback", false],
  ["?error=access_denied", "oauth", false],
  ["?error=access_denied&error_code=otp_expired", "link_expired", false],
])("%p ends on /login?error=%s", async (query, slug, exchangeFails) => {
  if (exchangeFails)
    exchangeCodeForSession.mockResolvedValue({ error: new Error("x") });
  const res = await callback(query, "/assets");
  expect(res.headers.get("location")).toBe(
    `http://localhost/login?error=${slug}`,
  );
});

it("clears the next cookie on its own path and is never cached", async () => {
  const res = await callback("?code=abc", "/assets");
  const cookie = res.headers.get("set-cookie") ?? "";
  expect(cookie).toContain("plant-auth-next=");
  expect(cookie).toContain("Path=/auth/callback");
  expect(cookie).toMatch(/Expires=Thu, 01 Jan 1970/);
  expect(res.headers.get("cache-control")).toContain("no-store");
});
