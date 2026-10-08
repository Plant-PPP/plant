export const REQUEST_ID_HEADER = "x-request-id";
// The request id's key on every log line.
export const REQUEST_ID_FIELD = "plant.request_id";

export function createRequestId(): string {
  return crypto.randomUUID();
}
