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

// Now in Unix seconds, the unit of amr timestamps.
export const unixNow = () => Math.floor(Date.now() / 1000);

// Whether the session has an amr entry for one of methods from the last
// windowS seconds. Auth writes each entry as { method, timestamp } from its
// own clock. A timestamp ahead of now is clock skew: the token is signed.
function amrEntryWithin(
  claims: MfaClaims,
  methods: ReadonlySet<unknown>,
  windowS: number,
  nowS: number,
): boolean {
  const { amr } = claims;
  return (
    Array.isArray(amr) &&
    amr.some(
      (entry: unknown) =>
        typeof entry === "object" &&
        entry !== null &&
        "method" in entry &&
        "timestamp" in entry &&
        methods.has(entry.method) &&
        typeof entry.timestamp === "number" &&
        entry.timestamp >= nowS - windowS,
    )
  );
}

// Every SensitiveAction needs, on claims that already passed mfaRequirement, a
// first-factor sign-in within STEP_UP_WINDOW_S. A user with TOTP passed
// mfaRequirement by verifying it after that sign-in, so the window covers both
// factors.
export function sensitiveRequirement(
  claims: MfaClaims,
  nowS: number,
): "met" | "sign_in_again" {
  return amrEntryWithin(claims, FIRST_FACTORS, STEP_UP_WINDOW_S, nowS)
    ? "met"
    : "sign_in_again";
}

// How recent the TOTP code behind turning MFA off must be: the dialog verifies
// one right before it calls the server.
export const TOTP_FRESH_S = 2 * 60;

const TOTP: ReadonlySet<unknown> = new Set(["totp"]);

export function totpIsFresh(claims: MfaClaims, nowS: number): boolean {
  return amrEntryWithin(claims, TOTP, TOTP_FRESH_S, nowS);
}
