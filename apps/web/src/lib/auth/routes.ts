import { sanitizeNextPath } from "./safe-redirect";

export const LOGIN_PATH = "/login";
export const CALLBACK_PATH = "/auth/callback";
const PUBLIC_PATHS = [LOGIN_PATH, "/auth"];

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

export function loginPath(next?: string): string {
  const safe = sanitizeNextPath(next);
  return safe === "/"
    ? LOGIN_PATH
    : `${LOGIN_PATH}?next=${encodeURIComponent(safe)}`;
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
