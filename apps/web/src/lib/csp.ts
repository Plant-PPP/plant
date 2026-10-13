export const CSP_HEADER = "content-security-policy";
export const NONCE_HEADER = "x-nonce";
export const REPORTING_HEADER = "reporting-endpoints";

// Where the browser reports a violation, with the page's request id, so the
// report's log line joins the page's.
export const reportPathFor = (requestId: string) =>
  `/api/reports?request=${requestId}`;

// The Reporting API's endpoint named by `report-to csp`.
export const reportingEndpoints = (reportPath: string) => `csp="${reportPath}"`;

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
  reportPath,
}: {
  nonce: string;
  connectOrigins: string[];
  dev: boolean;
  // Violations go here: report-to for browsers with the Reporting API,
  // report-uri for the rest.
  reportPath?: string;
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
    ...(reportPath ? { "report-uri": [reportPath], "report-to": ["csp"] } : {}),
  };
  return Object.entries(directives)
    .map(([name, sources]) => `${name} ${sources.join(" ")}`)
    .join("; ");
}
