import { isAuthSessionMissingError } from "@supabase/supabase-js";

// Auth's codes for a session that is gone for good. Anything else (a rate
// limit, a refresh conflict, a 5xx, the network) is Auth being unavailable,
// which must not sign the user out.
const SESSION_GONE_CODES = new Set([
  "refresh_token_not_found",
  "refresh_token_already_used",
  "session_not_found",
  "session_expired",
  "user_banned",
  "user_not_found",
  "bad_jwt",
]);

export type MaybeAuthError = { name?: string; code?: string } | null;

export function isSessionMissing(error: MaybeAuthError): boolean {
  if (!error) return true;
  return (
    isAuthSessionMissingError(error) ||
    error.name === "AuthInvalidJwtError" ||
    SESSION_GONE_CODES.has(error.code ?? "")
  );
}

// Set by proxy.ts on the forwarded request when Auth could not refresh the
// session, so server code throws instead of refreshing again.
export const AUTH_UNAVAILABLE_HEADER = "x-plant-auth";

const AUTH_UNAVAILABLE_ERROR = "AuthUnavailableError";

// What server code throws on that header.
export class AuthUnavailableError extends Error {
  constructor() {
    super("Auth unavailable");
    this.name = AUTH_UNAVAILABLE_ERROR;
  }
}

// By name, not instanceof: the instrumentation hook and the pages are built as
// separate bundles, which need not share the class.
export function isAuthUnavailable(error: unknown): error is Error {
  return error instanceof Error && error.name === AUTH_UNAVAILABLE_ERROR;
}
