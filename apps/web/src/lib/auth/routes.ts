import { isUnder } from "@/lib/paths";
import { pathOf, sanitizeNextPath } from "./safe-redirect";

export const LOGIN_PATH = "/login";
export const CALLBACK_PATH = "/auth/callback";
// Where an enrolled user's session verifies its factor (the screen is
// PLA-76's). It needs a session, so it is not public.
export const MFA_PATH = "/auth/mfa";
const PUBLIC_PATHS = [LOGIN_PATH, CALLBACK_PATH];

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => isUnder(p, pathname));
}

// Where to go after signing in or verifying a factor: a same-origin path that
// is not /login, the callback or the MFA step, which would only show the user
// the step they just finished.
export function afterLoginPath(raw: unknown): string {
  const safe = sanitizeNextPath(raw);
  const path = pathOf(safe);
  return isPublicPath(path) || isUnder(MFA_PATH, path) ? "/" : safe;
}

function withNext(base: string, next?: string): string {
  const safe = afterLoginPath(next);
  return safe === "/" ? base : `${base}?next=${encodeURIComponent(safe)}`;
}

export function loginPath(next?: string): string {
  return withNext(LOGIN_PATH, next);
}

export function mfaPath(next?: string): string {
  return withNext(MFA_PATH, next);
}

// Where to land after Google or a mail link. It rides in a cookie the callback
// alone receives, so the redirect URL stays the exact allow-listed callback.
// The form writes it with document.cookie (it is not HttpOnly), like the
// sidebar state in components/ui/sidebar.tsx.
export const NEXT_COOKIE = {
  name: "plant-auth-next",
  path: CALLBACK_PATH,
  maxAge: 600,
  sameSite: "Lax",
} as const;
