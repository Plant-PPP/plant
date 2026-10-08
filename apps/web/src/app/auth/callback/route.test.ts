import { NextRequest } from "next/server";

const exchangeCodeForSession = jest.fn();

jest.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { exchangeCodeForSession } }),
}));

import { GET } from "./route";

const REQUEST_ID = "12345678-aaaa-4bbb-8ccc-dddddddddddd";
const USER_ID = "a0000000-0000-4000-8000-00000000000a";

function callback(query: string, next?: string) {
  const headers: Record<string, string> = { "x-request-id": REQUEST_ID };
  if (next !== undefined)
    headers.cookie = `plant-auth-next=${encodeURIComponent(next)}`;
  return GET(
    new NextRequest(`http://localhost/auth/callback${query}`, { headers }),
  );
}

let log: jest.SpyInstance;
let warn: jest.SpyInstance;

beforeEach(() => {
  exchangeCodeForSession.mockReset();
  exchangeCodeForSession.mockResolvedValue({
    data: { user: { id: USER_ID } },
    error: null,
  });
  log = jest.spyOn(console, "log").mockImplementation(() => {});
  warn = jest.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

function logged(): { level: string; line: string } {
  const calls = [
    ...log.mock.calls.map(([line]) => ({ level: "info", line })),
    ...warn.mock.calls.map(([line]) => ({ level: "warn", line })),
  ];
  expect(calls).toHaveLength(1);
  return calls[0]!;
}

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
    exchangeCodeForSession.mockResolvedValue({
      data: { user: null },
      error: new Error("x"),
    });
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

describe("the callback line", () => {
  it.each([
    [
      "a sign-in",
      "?code=s3cr3t",
      "info",
      { "plant.outcome": "signed_in", "enduser.id": USER_ID },
    ],
    [
      "an expired link",
      "?error=access_denied&error_code=otp_expired",
      "info",
      { "plant.outcome": "link_expired" },
    ],
    [
      "a refusal on Google",
      "?error=access_denied",
      "info",
      { "plant.outcome": "oauth_error", "error.type": "access_denied" },
    ],
    [
      "another OAuth error",
      "?error=server_error&error_code=unexpected_failure",
      "warn",
      {
        "plant.outcome": "oauth_error",
        "error.type": "other",
        "plant.auth.error_code": "unexpected_failure",
      },
    ],
    [
      "an error code that is not Auth's",
      "?error=x&error_code=%3Cscript%3E",
      "warn",
      {
        "plant.outcome": "oauth_error",
        "error.type": "other",
        "plant.auth.error_code": "other",
      },
    ],
    ["no code", "", "warn", { "plant.outcome": "missing_code" }],
  ])("records %s", async (_label, query, level, fields) => {
    await callback(query, "/assets");
    const { level: loggedLevel, line } = logged();
    expect(loggedLevel).toBe(level);
    expect(JSON.parse(line)).toEqual({
      level,
      event: "auth.callback",
      "plant.request_id": REQUEST_ID,
      ...fields,
    });
  });

  it("records a failed exchange with Auth's code, never the code itself", async () => {
    exchangeCodeForSession.mockResolvedValue({
      data: { user: null },
      error: Object.assign(new Error("PKCE verifier s3cr3t"), {
        code: "bad_code_verifier",
      }),
    });
    await callback("?code=s3cr3t", "/assets");
    const { level, line } = logged();
    expect(level).toBe("warn");
    expect(JSON.parse(line)).toMatchObject({
      "plant.outcome": "exchange_failed",
      "error.type": "bad_code_verifier",
    });
    expect(line).not.toContain("s3cr3t");
  });
});
