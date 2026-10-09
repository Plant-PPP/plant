import { loginPath } from "./routes";

export const LOGIN_ERROR_SLUGS = [
  "invalid_email",
  "not_authorized",
  "rate_limited",
  "invalid_code",
  "link_expired",
  "callback",
  "oauth",
  "session_ended",
  "signed_out",
  "generic",
] as const;

export type LoginErrorSlug = (typeof LOGIN_ERROR_SLUGS)[number];

const COPY: Record<LoginErrorSlug, string> = {
  invalid_email: "Revisá el mail: no parece válido.",
  not_authorized: "Ese mail todavía no tiene acceso a Plant.",
  rate_limited:
    "Hiciste demasiados intentos. Esperá unos minutos y probá de nuevo.",
  invalid_code: "El código no es correcto o ya venció. Pedí uno nuevo.",
  link_expired: "El link ya venció. Pedí uno nuevo.",
  callback:
    "No pudimos terminar el ingreso. Probá de nuevo desde este navegador.",
  oauth: "No pudimos entrar con Google. Probá de nuevo.",
  session_ended:
    "Tu sesión ya se había cerrado. Ingresá de nuevo y cerrá la sesión en todos tus dispositivos.",
  signed_out: "Tu sesión se cerró. Ingresá de nuevo.",
  generic: "Algo salió mal. Probá de nuevo.",
};

// A Map, so a key like "constructor" from the query string finds nothing.
const LOGIN_ERRORS: ReadonlyMap<string, string> = new Map(Object.entries(COPY));

export function loginErrorMessage(slug: unknown): string | undefined {
  return typeof slug === "string" ? LOGIN_ERRORS.get(slug) : undefined;
}

export function loginErrorPath(slug: LoginErrorSlug, next?: string): string {
  const path = loginPath(next);
  return `${path}${path.includes("?") ? "&" : "?"}error=${slug}`;
}

// Sign-in errors from Auth, by code. session-state.ts reads the refresh codes.
const AUTH_ERROR_SLUGS: ReadonlyMap<string, LoginErrorSlug> = new Map([
  ["email_address_invalid", "invalid_email"],
  ["validation_failed", "invalid_email"],
  ["email_address_not_authorized", "not_authorized"],
  ["over_email_send_rate_limit", "rate_limited"],
  ["over_request_rate_limit", "rate_limited"],
  ["otp_expired", "invalid_code"],
]);

export function authErrorSlug(error: { code?: string } | null): LoginErrorSlug {
  return AUTH_ERROR_SLUGS.get(error?.code ?? "") ?? "generic";
}
