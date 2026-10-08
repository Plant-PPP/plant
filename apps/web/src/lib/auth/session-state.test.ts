import {
  AuthApiError,
  AuthInvalidJwtError,
  AuthRetryableFetchError,
  AuthSessionMissingError,
} from "@supabase/supabase-js";
import { isSessionMissing } from "./session-state";

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
