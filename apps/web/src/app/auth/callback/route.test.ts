import {
  AuthApiError,
  AuthPKCECodeVerifierMissingError,
  AuthRetryableFetchError,
} from "@supabase/supabase-js";
import { NextRequest } from "next/server";

const exchangeCodeForSession = jest.fn();

jest.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { exchangeCodeForSession } }),
}));

import { GET } from "./route";

const REQUEST_ID = "12345678-aaaa-4bbb-8ccc-dddddddddddd";
const USER_ID = "a0000000-0000-4000-8000-00000000000a";

function callback(query: string, next?: string, requestId = REQUEST_ID) {
  const headers: Record<string, string> = { "x-request-id": requestId };
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
      { "plant.outcome": "link_expired", "plant.auth.reason": "otp_expired" },
    ],
    [
      "a refusal on Google",
      "?error=access_denied",
      "info",
      { "plant.outcome": "oauth_error", "plant.auth.reason": "access_denied" },
    ],
    [
      "a refusal on Google with Auth's access_denied code",
      "?error=access_denied&error_code=access_denied",
      "info",
      {
        "plant.outcome": "oauth_error",
        "plant.auth.reason": "access_denied",
        "plant.auth.error_code": "access_denied",
      },
    ],
    [
      "another OAuth error",
      "?error=server_error&error_code=unexpected_failure",
      "warn",
      {
        "plant.outcome": "oauth_error",
        "error.type": "_OTHER",
        "plant.auth.error_code": "unexpected_failure",
      },
    ],
    [
      "a refusal by Auth",
      "?error=access_denied&error_code=signup_disabled",
      "warn",
      {
        "plant.outcome": "oauth_error",
        "error.type": "_OTHER",
        "plant.auth.error_code": "signup_disabled",
      },
    ],
    [
      "an error code that is not Auth's",
      "?error=x&error_code=%3Cscript%3E",
      "warn",
      {
        "plant.outcome": "oauth_error",
        "error.type": "_OTHER",
        "plant.auth.error_code": "other",
      },
    ],
    [
      "no code",
      "",
      "warn",
      { "plant.outcome": "missing_code", "error.type": "missing_code" },
    ],
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

  it("drops a request id that is not a UUID", async () => {
    await callback("", "/assets", `${REQUEST_ID}x`);
    expect(JSON.parse(logged().line)).not.toHaveProperty("plant.request_id");
  });

  it.each([
    [
      "a link opened in another browser",
      new AuthPKCECodeVerifierMissingError(),
      {
        "error.type": "pkce_code_verifier_not_found",
        "plant.auth.status": 400,
      },
    ],
    [
      "a code Auth rejects",
      new AuthApiError("PKCE verifier s3cr3t", 400, "bad_code_verifier"),
      { "error.type": "bad_code_verifier", "plant.auth.status": 400 },
    ],
    [
      "Auth failing, as when the audit insert fails",
      new AuthRetryableFetchError("Internal Server Error", 500),
      { "error.type": "AuthRetryableFetchError", "plant.auth.status": 500 },
    ],
    [
      "no answer from Auth",
      new AuthRetryableFetchError("fetch failed", 0),
      { "error.type": "AuthRetryableFetchError", "plant.auth.status": 0 },
    ],
  ])(
    "records a failed exchange on %s with the error's status, never the code",
    async (_label, error, fields) => {
      exchangeCodeForSession.mockResolvedValue({ data: { user: null }, error });
      await callback("?code=s3cr3t", "/assets");
      const { level, line } = logged();
      expect(level).toBe("warn");
      expect(JSON.parse(line)).toEqual({
        level: "warn",
        event: "auth.callback",
        "plant.request_id": REQUEST_ID,
        "plant.outcome": "exchange_failed",
        ...fields,
      });
      expect(line).not.toContain("s3cr3t");
    },
  );
});
