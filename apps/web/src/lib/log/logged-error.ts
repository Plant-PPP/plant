const LOGGED_ERROR = "LoggedError";

// Thrown after the failure was already logged, so the error page shows while
// onRequestError skips it: one failure, one line. The message is a static
// code.
export class LoggedError extends Error {
  override readonly name = LOGGED_ERROR;
}

// By name, not instanceof: the instrumentation hook and the pages are built as
// separate bundles, which need not share the class.
export function isLoggedError(error: unknown): boolean {
  return error instanceof Error && error.name === LOGGED_ERROR;
}
