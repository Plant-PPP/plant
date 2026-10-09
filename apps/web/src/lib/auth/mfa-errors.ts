import { authErrorSlug, loginErrorMessage } from "./login-errors";
import type { AuthFailure } from "./use-auth-request";

const WRONG_CODE =
  "El código no es válido. Probá con el que muestra tu app ahora.";
const RETRY = "No pudimos preparar la configuración. Reintentá.";
const NOT_AVAILABLE = "Todavía no está disponible.";

// A Map, so a code like "constructor" finds nothing.
const MFA_ERRORS: ReadonlyMap<string, string> = new Map([
  ["mfa_verification_failed", WRONG_CODE],
  ["mfa_challenge_expired", WRONG_CODE],
  ["mfa_factor_name_conflict", RETRY],
  ["too_many_enrolled_mfa_factors", RETRY],
  ["mfa_totp_enroll_not_enabled", NOT_AVAILABLE],
  ["mfa_totp_verify_not_enabled", NOT_AVAILABLE],
  // Another tab or device replaced or removed the factor this page shows.
  [
    "mfa_factor_not_found",
    "Tu app de autenticación cambió. Recargá la página y probá de nuevo.",
  ],
  ["insufficient_aal", "Tu sesión cambió. Recargá la página y probá de nuevo."],
]);

// Rate limits and anything else read as they do at sign-in.
export function mfaErrorMessage(failure: AuthFailure): string {
  return (
    MFA_ERRORS.get(failure.code ?? "") ??
    loginErrorMessage(authErrorSlug(failure))!
  );
}
