// An error's code when it has one (Auth's, Node's), else its class, so one
// failure reads the same on every line, the server's and the browser's.
export function errorType(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const { code, name } = error as { name?: unknown; code?: unknown };
  if (typeof code === "string" && code) return code;
  return typeof name === "string" && name ? name : undefined;
}

// The digest Next gives a server error, which the error page gets instead of
// the error.
export function errorDigest(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const { digest } = error as { digest?: unknown };
  return typeof digest === "string" ? digest : undefined;
}
