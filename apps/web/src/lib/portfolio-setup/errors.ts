// A failed portfolio setup write or read, as logged: the code is the
// classifier's, never PostgREST's message, details or hint, which carry the
// row.
export class PortfolioSetupError extends Error {
  override readonly name = "PortfolioSetupError";

  constructor(readonly code: string) {
    super(code);
  }
}
