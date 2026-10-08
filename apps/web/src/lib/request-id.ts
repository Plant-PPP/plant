export const REQUEST_ID_HEADER = "x-request-id";
// The request id's key on every log line.
export const REQUEST_ID_FIELD = "plant.request_id";

export function createRequestId(): string {
  return crypto.randomUUID();
}

// The shape createRequestId produces.
export function isRequestId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)
  );
}
