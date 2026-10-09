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
    // By name too: a failure copied out of a thrown error keeps only that.
    error.name === "AuthSessionMissingError" ||
    error.name === "AuthInvalidJwtError" ||
    SESSION_GONE_CODES.has(error.code ?? "")
  );
}

// A failed request whose session had ended, as opposed to no failure at all.
export function failedOnEndedSession(failure: MaybeAuthError): boolean {
  return failure !== null && isSessionMissing(failure);
}

// Set by proxy.ts on the forwarded request when it could not use the session,
// so server code throws instead of refreshing again. Its value is the reason,
// which is also the outcome both sides log: Auth could not refresh it, or the
// token lacks the MFA claim because the access token hook is off.
export const AUTH_UNAVAILABLE_HEADER = "x-plant-auth";

const REASONS = ["auth_unavailable", "mfa_claim_missing"] as const;
export type AuthUnavailableReason = (typeof REASONS)[number];

function toReason(value: unknown): AuthUnavailableReason {
  return REASONS.find((reason) => reason === value) ?? "auth_unavailable";
}

// The reason proxy.ts recorded, or null when it found the session usable.
// Outside the proxy's matcher the header is whatever the client sent, so any
// value it does not know reads as auth_unavailable.
export function unavailableReason(
  headers: Headers,
): AuthUnavailableReason | null {
  const value = headers.get(AUTH_UNAVAILABLE_HEADER);
  return value === null ? null : toReason(value);
}

export const AUTH_UNAVAILABLE_ERROR = "AuthUnavailableError";

export class AuthUnavailableError extends Error {
  override readonly name = AUTH_UNAVAILABLE_ERROR;

  constructor(readonly reason: AuthUnavailableReason = "auth_unavailable") {
    super("Auth unavailable");
  }
}

// The reason an AuthUnavailableError carries, or null for any other error. By
// name, not instanceof: the instrumentation hook and the pages are built as
// separate bundles, which need not share the class, so the reason is checked
// too.
export function authUnavailableReason(
  error: unknown,
): AuthUnavailableReason | null {
  if (!(error instanceof Error) || error.name !== AUTH_UNAVAILABLE_ERROR) {
    return null;
  }
  return toReason((error as { reason?: unknown }).reason);
}
