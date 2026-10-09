import { mfaErrorMessage } from "./mfa-errors";

it.each(["mfa_verification_failed", "mfa_challenge_expired"])(
  "asks for the app's current code on %s",
  (code) => {
    expect(mfaErrorMessage({ code })).toBe(
      "El código no es válido. Probá con el que muestra tu app ahora.",
    );
  },
);

it.each(["mfa_totp_enroll_not_enabled", "mfa_totp_verify_not_enabled"])(
  "says TOTP is not available yet on %s",
  (code) => {
    expect(mfaErrorMessage({ code })).toBe("Todavía no está disponible.");
  },
);

it.each([{ name: "AuthSessionMissingError" }, { code: "session_not_found" }])(
  "asks to sign in again when the session has ended (%p)",
  (failure) => {
    expect(mfaErrorMessage(failure)).toBe(
      "Tu sesión se cerró. Ingresá de nuevo.",
    );
  },
);

it("reads a rate limit as the sign-in does", () => {
  expect(mfaErrorMessage({ code: "over_request_rate_limit" })).toBe(
    "Hiciste demasiados intentos. Esperá unos minutos y probá de nuevo.",
  );
});

it.each([{}, { code: "constructor" }, { code: "something_new" }])(
  "falls back to the generic copy for %p",
  (failure) => {
    expect(mfaErrorMessage(failure)).toBe("Algo salió mal. Probá de nuevo.");
  },
);

it.each([
  [
    "mfa_factor_name_conflict",
    "No pudimos preparar la configuración. Reintentá.",
  ],
  [
    "too_many_enrolled_mfa_factors",
    "No pudimos preparar la configuración. Reintentá.",
  ],
  ["insufficient_aal", "Tu sesión cambió. Recargá la página y probá de nuevo."],
  [
    "mfa_factor_not_found",
    "Tu app de autenticación cambió. Recargá la página y probá de nuevo.",
  ],
])("maps %s to its copy", (code, copy) => {
  expect(mfaErrorMessage({ code })).toBe(copy);
});
