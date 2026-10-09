import {
  AuthApiError,
  AuthInvalidJwtError,
  AuthRetryableFetchError,
  AuthSessionMissingError,
} from "@supabase/supabase-js";
import {
  AuthUnavailableError,
  authUnavailableReason,
  isSessionMissing,
  unavailableReason,
} from "./session-state";

type Case = [string, Parameters<typeof isSessionMissing>[0]];

function apiError(status: number, code?: string) {
  return new AuthApiError("message", status, code);
}

describe("isSessionMissing", () => {
  it.each<Case>([
    ["no error", null],
    ["no session", new AuthSessionMissingError()],
    ["an invalid JWT", new AuthInvalidJwtError("bad")],
    ...[
      "refresh_token_not_found",
      "refresh_token_already_used",
      "session_not_found",
      "session_expired",
      "user_banned",
      "user_not_found",
      "bad_jwt",
    ].map((code): Case => [code, apiError(400, code)]),
  ])("is true for %s", (_, error) => {
    expect(isSessionMissing(error)).toBe(true);
  });

  it.each<Case>([
    ["a rate limit", apiError(429, "over_request_rate_limit")],
    ["a refresh conflict", apiError(409, "conflict")],
    ["a server error", apiError(500)],
    ["a network error", new AuthRetryableFetchError("fetch failed", 0)],
    ["a 401 with no code", apiError(401)],
  ])("is false for %s", (_, error) => {
    expect(isSessionMissing(error)).toBe(false);
  });
});

describe("unavailableReason", () => {
  function headers(value?: string) {
    return new Headers(value === undefined ? {} : { "x-plant-auth": value });
  }

  it("is null when proxy.ts found the session usable", () => {
    expect(unavailableReason(headers())).toBeNull();
  });

  it.each(["auth_unavailable", "mfa_claim_missing"])("reads %s", (value) => {
    expect(unavailableReason(headers(value))).toBe(value);
  });

  it.each(["", "unavailable", "MFA_CLAIM_MISSING", "toString"])(
    "reads %j, which proxy.ts never writes, as auth_unavailable",
    (value) => {
      expect(unavailableReason(headers(value))).toBe("auth_unavailable");
    },
  );
});

describe("authUnavailableReason", () => {
  function foreign(reason?: unknown) {
    return Object.assign(new Error("Auth unavailable"), {
      name: "AuthUnavailableError",
      reason,
    });
  }

  it.each(["auth_unavailable", "mfa_claim_missing"] as const)(
    "reads %s from the error",
    (reason) => {
      expect(authUnavailableReason(new AuthUnavailableError(reason))).toBe(
        reason,
      );
    },
  );

  it("defaults to auth_unavailable", () => {
    expect(authUnavailableReason(new AuthUnavailableError())).toBe(
      "auth_unavailable",
    );
  });

  it("reads another bundle's error by name", () => {
    expect(authUnavailableReason(foreign("mfa_claim_missing"))).toBe(
      "mfa_claim_missing",
    );
  });

  it.each([undefined, "other", 1])(
    "reads another bundle's error with reason %j as auth_unavailable",
    (reason) => {
      expect(authUnavailableReason(foreign(reason))).toBe("auth_unavailable");
    },
  );

  it.each([
    ["another error", new Error("Auth unavailable")],
    ["a thrown string", "AuthUnavailableError"],
    [
      "an object named like it",
      { name: "AuthUnavailableError", reason: "mfa_claim_missing" },
    ],
    ["null", null],
  ])("is null for %s", (_, error) => {
    expect(authUnavailableReason(error)).toBeNull();
  });
});
