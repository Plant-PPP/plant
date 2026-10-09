import "server-only";
import { serverLog, type LogLevel } from "@/lib/log/server-log";
import { REQUEST_ID_FIELD } from "@/lib/request-id";
import type { AuthClient } from "./mfa-factors";
import { type MfaClaims, totpIsFresh } from "./mfa-rules";
import type { SensitiveSession } from "./sensitive-session";
import { isSessionMissing, type MaybeAuthError } from "./session-state";

export type DisableOutcome =
  | "disabled"
  | "totp_stale"
  | "factor_not_found"
  | "user_mismatch"
  | "invalid_input"
  | "session_ended"
  | "session_refresh_failed"
  | "partial"
  | "error";

const LEVELS: Record<DisableOutcome, LogLevel> = {
  disabled: "info",
  totp_stale: "info",
  session_ended: "info",
  factor_not_found: "warn",
  user_mismatch: "warn",
  invalid_input: "warn",
  session_refresh_failed: "warn",
  partial: "error",
  error: "error",
};

type Counts = { removed?: number; verified?: number };

export function logDisable(
  outcome: DisableOutcome,
  fields: { requestId?: string; userId?: string } & Counts,
  error?: unknown,
): { outcome: DisableOutcome } {
  const line = {
    [REQUEST_ID_FIELD]: fields.requestId,
    "enduser.id": fields.userId,
    "plant.outcome": outcome,
    "plant.auth.mfa_factors_removed.count": fields.removed,
    "plant.auth.mfa_factors_verified.count": fields.verified,
  };
  const level = LEVELS[outcome];
  if (level === "error") serverLog.error("auth.mfa.disable", line, error);
  else serverLog[level]("auth.mfa.disable", line);
  return { outcome };
}

// Removes every verified factor of the session's user, once the sensitive gate
// let the request through and the session verified a TOTP code in the last
// TOTP_FRESH_S. Auth drops a session to aal1 when the factor it verified is
// removed, after which it cannot remove another, so factorId (the one the
// dialog just verified) goes last.
export async function unenrollForSession({
  session,
  claims,
  client,
  factorId,
  requestId,
}: {
  session: SensitiveSession;
  claims: MfaClaims;
  client: AuthClient;
  factorId: string;
  requestId?: string;
}): Promise<{ outcome: DisableOutcome }> {
  const log = { requestId, userId: session.userId };
  if (!totpIsFresh(claims, Math.floor(Date.now() / 1000))) {
    return logDisable("totp_stale", log);
  }

  const { data, error } = await client.auth.getUser();
  if (error) {
    return isSessionMissing(error as MaybeAuthError)
      ? logDisable("session_ended", log)
      : logDisable("error", log, error);
  }
  // Both come from the same cookie; this keeps it that way.
  if (data.user.id !== session.userId) return logDisable("user_mismatch", log);

  const verified = (data.user.factors ?? []).filter(
    (factor) => factor.status === "verified",
  );
  const counts = { ...log, verified: verified.length };
  if (!verified.some((factor) => factor.id === factorId)) {
    return logDisable("factor_not_found", { ...counts, removed: 0 });
  }

  const order = [
    ...verified.filter((factor) => factor.id !== factorId).map((f) => f.id),
    factorId,
  ];
  let removed = 0;
  for (const id of order) {
    const { error: unenrollError } = await client.auth.mfa.unenroll({
      factorId: id,
    });
    if (unenrollError) {
      return logDisable(
        removed === 0 ? "error" : "partial",
        { ...counts, removed },
        unenrollError,
      );
    }
    removed += 1;
  }

  // The new token says the user has no factor, so the proxy stops asking.
  const { error: refreshError } = await client.auth.refreshSession();
  if (refreshError) {
    return logDisable("session_refresh_failed", { ...counts, removed });
  }
  return logDisable("disabled", { ...counts, removed });
}
