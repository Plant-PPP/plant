import "server-only";
import { feedErrorForStatus, type GetJson, QuoteFeedError } from "@plant/core";

const TIMEOUT_MS = 10_000;
const MAX_BYTES = 2 * 1024 * 1024;

// Read by name: the DOMException fetch rejects with can come from another
// realm than this module's Error.
const isTimeout = (error: unknown) =>
  typeof error === "object" &&
  error !== null &&
  "name" in error &&
  error.name === "TimeoutError";

// Reads the body chunk by chunk and stops past MAX_BYTES, so a source that
// sends no length or a wrong one cannot fill memory.
async function readCapped(response: Response): Promise<string> {
  const length = Number(response.headers.get("content-length"));
  if (length > MAX_BYTES) throw new QuoteFeedError("too_large");
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) {
      await reader.cancel();
      throw new QuoteFeedError("too_large");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

// The quote feeds' HTTP reader. Every error it throws is a QuoteFeedError, and
// none carries the body or the parser's message. Inngest retries the step. A
// redirect is answered by its status (`http_4xx`, not retried), so a moved
// endpoint reads as moved rather than as a network failure.
export const getJson: GetJson = async (url) => {
  let text: string;
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: "manual",
      cache: "no-store",
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw feedErrorForStatus(response.status);
    }
    text = await readCapped(response);
  } catch (error) {
    if (error instanceof QuoteFeedError) throw error;
    throw new QuoteFeedError(isTimeout(error) ? "timeout" : "fetch_error");
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new QuoteFeedError("bad_json");
  }
};
