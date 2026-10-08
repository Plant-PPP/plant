export const CSP_HEADER = "content-security-policy";
export const NONCE_HEADER = "x-nonce";

// 128 random bits, base64: the form Next accepts in 'nonce-…'.
export function createNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}

// Next stamps the nonce on its own scripts; chunks load from 'self', so
// 'strict-dynamic' is not needed. React needs eval only under `next dev`.
// Styles stay 'unsafe-inline': the sidebar renders style="" attributes with
// its CSS variables, which a nonce cannot cover.
export function buildCsp({
  nonce,
  connectOrigins,
  dev,
}: {
  nonce: string;
  connectOrigins: string[];
  dev: boolean;
}): string {
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": [
      "'self'",
      `'nonce-${nonce}'`,
      ...(dev ? ["'unsafe-eval'"] : []),
    ],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:"],
    "font-src": ["'self'"],
    "connect-src": ["'self'", ...connectOrigins],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
  };
  return Object.entries(directives)
    .map(([name, sources]) => `${name} ${sources.join(" ")}`)
    .join("; ");
}
