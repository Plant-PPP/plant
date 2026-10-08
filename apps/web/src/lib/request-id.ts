export const REQUEST_ID_HEADER = "x-request-id";

export function createRequestId(): string {
  return crypto.randomUUID();
}
