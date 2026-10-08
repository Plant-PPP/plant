export const REQUEST_ID_HEADER = "x-request-id";
export const REQUEST_ID_FIELD = "plant.request_id";

export function createRequestId(): string {
  return crypto.randomUUID();
}

// A request id read back from a header, kept only if it is a whole UUID:
// outside the proxy's matcher the header is whatever the client sent.
export function requestIdFrom(value: unknown): string | undefined {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)
    ? value
    : undefined;
}
