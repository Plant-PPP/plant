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
