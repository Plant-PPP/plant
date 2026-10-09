import { FIRST_FACTOR_METHODS, MFA_ENROLLED_CLAIM } from "@plant/shared";

// Verified claims, typed unknown: the hook's claim and Auth's amr are checked
// here, not trusted to have the shape the types say.
export type MfaClaims = { aal?: unknown; amr?: unknown } & {
  [MFA_ENROLLED_CLAIM]?: unknown;
};

// Every request of a user with a verified factor needs aal2. The rule is the
// truth table in supabase/tests/mfa_gate_test.sql, which the RESTRICTIVE
// policy follows too. Below aal2 a token without the claim is claim_missing:
// the hook that adds it is off, and the policy refuses the token as enrolled.
export function mfaRequirement(
  claims: MfaClaims,
): "met" | "verify" | "claim_missing" {
  if (claims.aal === "aal2") return "met";
  const enrolled = claims[MFA_ENROLLED_CLAIM];
  if (enrolled === false) return "met";
  if (enrolled === true) return "verify";
  return "claim_missing";
}

// How recent a sign-in with the mailbox or Google must be for a sensitive
// action.
export const STEP_UP_WINDOW_S = 15 * 60;

const FIRST_FACTORS: ReadonlySet<unknown> = new Set(FIRST_FACTOR_METHODS);

// Export, account deletion and email change, on claims that already passed
// mfaRequirement: they need a first-factor sign-in within STEP_UP_WINDOW_S.
// A user with TOTP passed mfaRequirement by verifying it after that sign-in,
// so the window covers both factors. Auth writes each amr entry as
// { method, timestamp } in Unix seconds; nowS is in Unix seconds too.
export function sensitiveRequirement(
  claims: MfaClaims,
  nowS: number,
): "met" | "sign_in_again" {
  const { amr } = claims;
  const recent =
    Array.isArray(amr) &&
    amr.some(
      (entry: unknown) =>
        typeof entry === "object" &&
        entry !== null &&
        "method" in entry &&
        "timestamp" in entry &&
        FIRST_FACTORS.has(entry.method) &&
        typeof entry.timestamp === "number" &&
        entry.timestamp >= nowS - STEP_UP_WINDOW_S,
    );
  return recent ? "met" : "sign_in_again";
}
