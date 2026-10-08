export const REQUEST_ID_HEADER = "x-request-id";
// The request id's key on a log line.
export const REQUEST_ID_FIELD = "plant.request_id";

export function createRequestId(): string {
  return crypto.randomUUID();
}

// A request id read back from a header, kept only in the shape
// createRequestId produces: outside the proxy's matcher the header is
// whatever the client sent.
export function requestIdFrom(value: unknown): string | undefined {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)
    ? value
    : undefined;
}
